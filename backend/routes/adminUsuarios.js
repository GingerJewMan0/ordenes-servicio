'use strict';
// Administración de técnicos. Las cuentas administradoras se gestionan fuera
// de este módulo para impedir bloqueos accidentales o escaladas de privilegios.
const express = require('express');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);

const REGEX_USUARIO = /^[a-z0-9._-]{3,80}$/;
const CAMPOS_PUBLICOS = 'id::text AS id, usuario, rol, activo, creado_en';

function validarClave(clave) {
  return typeof clave === 'string' && clave.length >= 12 && clave.length <= 128 && Buffer.byteLength(clave, 'utf8') <= 512;
}

async function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const digest = await scrypt(clave, Buffer.from(sal, 'hex'), 64, {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024});
  return `scrypt$16384$8$1$${sal}$${digest.toString('hex')}`;
}

function crearRouterAdminUsuarios(pool) {
  const router = express.Router();

  // La autenticación se monta en server.js ANTES de este router y se aplica
  // siempre, incluso si APP_AUTH_REQUIRED=false para otras rutas.
  router.use((req, res, next) => {
    if (!req.usuarioApp) return res.status(401).json({error: 'Inicia sesión para continuar.'});
    if (req.usuarioApp.rol !== 'admin') return res.status(403).json({error: 'Solo los administradores pueden gestionar usuarios.'});
    next();
  });

  function dbError(res, error, contexto) {
    if (error?.code === '23505') return res.status(409).json({error: 'Ese nombre de usuario ya existe.'});
    console.error(`[admin-usuarios/${contexto}]`, error?.code || error?.message || 'error');
    return res.status(503).json({error: 'No se pudo completar la operación. Inténtalo nuevamente.'});
  }

  // Nunca devolver clave_hash ni tokens.
  router.get('/', async (_req, res) => {
    try {
      const {rows} = await pool.query(`SELECT ${CAMPOS_PUBLICOS} FROM public.app_usuarios ORDER BY id ASC`);
      res.json({usuarios: rows});
    } catch (e) { dbError(res, e, 'listar'); }
  });

  router.post('/', async (req, res) => {
    const usuario = String(req.body?.usuario || '').trim().toLowerCase();
    const clave = req.body?.clave;
    if (!REGEX_USUARIO.test(usuario) || !validarClave(clave)) {
      return res.status(400).json({error: 'Usuario de 3 a 80 caracteres (letras minúsculas, números, . _ -) y contraseña de 12 a 128 caracteres.'});
    }
    // Este panel solo da de alta técnicos; crear admins requiere un procedimiento separado.
    if (req.body?.rol !== undefined && req.body.rol !== 'tecnico') {
      return res.status(400).json({error: 'Desde este panel solo se pueden crear cuentas de técnico.'});
    }
    try {
      const claveHash = await hashClave(clave);
      const {rows} = await pool.query(`
        INSERT INTO public.app_usuarios (usuario, clave_hash, rol, activo)
        VALUES ($1, $2, 'tecnico', TRUE)
        RETURNING ${CAMPOS_PUBLICOS}
      `, [usuario, claveHash]);
      res.status(201).json({usuario: rows[0]});
    } catch (e) { dbError(res, e, 'crear'); }
  });

  async function modificarTecnico(req, res, cambio) {
    const id = String(req.params.id || '');
    if (!/^\d{1,18}$/.test(id)) return res.status(400).json({error: 'Identificador inválido.'});
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const {rows} = await client.query(`SELECT id, rol, activo, usuario FROM public.app_usuarios WHERE id=$1 FOR UPDATE`, [id]);
      const actual = rows[0];
      if (!actual) { await client.query('ROLLBACK'); return res.status(404).json({error: 'Usuario no encontrado.'}); }
      if (actual.rol !== 'tecnico') { await client.query('ROLLBACK'); return res.status(403).json({error: 'No puedes modificar cuentas administradoras desde esta pantalla.'}); }
      const resultado = await cambio(client, actual);
      await client.query('COMMIT');
      return res.json(resultado);
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return dbError(res, e, 'modificar');
    } finally {
      if (client) client.release();
    }
  }

  router.patch('/:id', async (req, res) => {
    const tieneUsuario = Object.prototype.hasOwnProperty.call(req.body || {}, 'usuario');
    const tieneActivo = Object.prototype.hasOwnProperty.call(req.body || {}, 'activo');
    if (!tieneUsuario && !tieneActivo) return res.status(400).json({error: 'No hay cambios para guardar.'});
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rol')) return res.status(400).json({error: 'El rol no se puede modificar desde esta pantalla.'});
    const usuario = tieneUsuario ? String(req.body.usuario || '').trim().toLowerCase() : null;
    const activo = tieneActivo ? req.body.activo : null;
    if ((tieneUsuario && !REGEX_USUARIO.test(usuario)) || (tieneActivo && typeof activo !== 'boolean')) {
      return res.status(400).json({error: 'Nombre de usuario o estado inválido.'});
    }
    return modificarTecnico(req, res, async (client, actual) => {
      const nombreFinal = tieneUsuario ? usuario : actual.usuario;
      const activoFinal = tieneActivo ? activo : actual.activo;
      const {rows} = await client.query(`
        UPDATE public.app_usuarios SET usuario=$2, activo=$3 WHERE id=$1
        RETURNING ${CAMPOS_PUBLICOS}
      `, [String(actual.id), nombreFinal, activoFinal]);
      // Desactivar revoca inmediatamente todas las sesiones, aunque hubiera
      // un inicio de sesión anterior en el mismo dispositivo.
      if (tieneActivo && !activoFinal) await client.query('DELETE FROM public.app_sesiones WHERE usuario_id=$1', [String(actual.id)]);
      return {usuario: rows[0]};
    });
  });

  router.put('/:id/clave', async (req, res) => {
    if (!/^\d{1,18}$/.test(String(req.params.id || ''))) return res.status(400).json({error: 'Identificador inválido.'});
    const clave = req.body?.clave;
    if (!validarClave(clave)) return res.status(400).json({error: 'La contraseña debe tener entre 12 y 128 caracteres.'});
    // Calcular el hash fuera de la transacción reduce la duración del bloqueo.
    let claveHash;
    try { claveHash = await hashClave(clave); }
    catch (e) { return dbError(res, e, 'hash-clave'); }
    return modificarTecnico(req, res, async (client, actual) => {
      await client.query('UPDATE public.app_usuarios SET clave_hash=$2 WHERE id=$1', [String(actual.id), claveHash]);
      await client.query('DELETE FROM public.app_sesiones WHERE usuario_id=$1', [String(actual.id)]);
      return {claveActualizada: true, sesionesRevocadas: true};
    });
  });

  return router;
}

module.exports = {crearRouterAdminUsuarios};
