'use strict';
// Administración de técnicos: crear, renombrar, cambiar contraseña y eliminar.
// Las cuentas administradoras se gestionan fuera
// de este módulo para impedir bloqueos accidentales o escaladas de privilegios.
const express = require('express');
const { registrarAuditoria } = require('../security/auditoria');
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
    if (error?.code === '23503') return res.status(409).json({error: 'La cuenta tiene referencias en la base de datos. No se puede eliminar sin afectar el historial.'});
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
    let client;
    try {
      const claveHash = await hashClave(clave);
      client = await pool.connect();
      await client.query('BEGIN');
      const {rows} = await client.query(`
        INSERT INTO public.app_usuarios (usuario, clave_hash, rol, activo)
        VALUES ($1, $2, 'tecnico', TRUE)
        RETURNING ${CAMPOS_PUBLICOS}
      `, [usuario, claveHash]);
      await registrarAuditoria(client, req, {
        modulo: 'usuarios', accion: 'crear', registroId: rows[0].id
      });
      await client.query('COMMIT');
      res.status(201).json({usuario: rows[0]});
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      dbError(res, e, 'crear');
    } finally {
      client?.release();
    }
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
      if (e?.code === 'USUARIO_CON_HISTORIAL') return res.status(409).json({error: e.message});
      return dbError(res, e, 'modificar');
    } finally {
      if (client) client.release();
    }
  }

  // Los sistemas históricos registran la autoría principalmente por el nombre
  // de acceso. Sin una tabla de alias con IDs inmutables, un cambio de nombre
  // puede separar al técnico de sus evidencias y capturas pendientes.
  // La consulta compartida se ejecuta DENTRO de la transacción y del bloqueo
  // FOR UPDATE de app_usuarios, tanto al renombrar como al eliminar.
  async function tieneHistorialTecnico(client, actual) {
    const {rows} = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM public.app_auditoria
               WHERE usuario_id=$1::bigint OR usuario=$2) OR
        -- Un renombre anterior obliga a conservar el ID y su trazabilidad;
        -- las referencias al alias antiguo podrían seguir existiendo.
        EXISTS(SELECT 1 FROM public.app_auditoria
               WHERE modulo='usuarios' AND accion='editar'
                 AND registro_id::text=$1::text) OR
        EXISTS(SELECT 1 FROM public.ordenes_captura_evidencias
               WHERE usuario_creador=$2) OR
        EXISTS(SELECT 1 FROM public.ordenes_evidencias
               WHERE creado_por_usuario=$2) OR
        EXISTS(SELECT 1 FROM public.ordenes_servicio
               WHERE tecnico_servicio=$2) OR
        EXISTS(SELECT 1 FROM public.viaticos_captura_comprobantes
               WHERE usuario_creador=$2) OR
        EXISTS(SELECT 1 FROM public.viaticos_comprobantes
               WHERE creado_por_usuario=$2 OR cambiado_por_usuario=$2)
        AS tiene_historial
    `, [String(actual.id), actual.usuario]);
    // En caso de respuesta desconocida, fallar cerrado: nunca asumir ausencia.
    if (rows.length !== 1 || typeof rows[0].tiene_historial !== 'boolean') {
      const e = new Error('No se pudo comprobar el historial del técnico.');
      e.code = 'HISTORIAL_INDETERMINADO';
      throw e;
    }
    return rows[0].tiene_historial;
  }

  function rechazarHistorial(accion) {
    const e = new Error(accion === 'renombrar'
      ? 'Este técnico ya tiene actividad o cambios de nombre anteriores. Para conservar la autoría de órdenes, evidencias y viáticos, su nombre de acceso no puede cambiarse desde la aplicación. Sí puedes restablecer su contraseña.'
      : 'Este técnico tiene actividad o cambios de nombre anteriores. No se puede eliminar definitivamente desde la aplicación sin poner en riesgo su historial.');
    e.code = 'USUARIO_CON_HISTORIAL';
    throw e;
  }

  router.patch('/:id', async (req, res) => {
    // Solo se permite cambiar el nombre. No activar, desactivar ni cambiar roles.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rol') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'activo')) {
      return res.status(400).json({error: 'Este panel solo permite editar nombres de técnicos; no permite cambiar roles o estados.'});
    }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'usuario')) {
      return res.status(400).json({error: 'Indica el nuevo nombre de usuario.'});
    }
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    if (!REGEX_USUARIO.test(usuario)) {
      return res.status(400).json({error: 'Nombre de usuario inválido.'});
    }
    return modificarTecnico(req, res, async (client, actual) => {
      if (usuario !== actual.usuario && await tieneHistorialTecnico(client, actual)) {
        rechazarHistorial('renombrar');
      }
      const {rows} = await client.query(`
        UPDATE public.app_usuarios SET usuario=$2 WHERE id=$1
        RETURNING ${CAMPOS_PUBLICOS}
      `, [String(actual.id), usuario]);
      if (usuario !== actual.usuario) {
        // Invalidar sesiones antiguas: no deben conservar una identidad desactualizada.
        await client.query('DELETE FROM public.app_sesiones WHERE usuario_id=$1', [String(actual.id)]);
        await registrarAuditoria(client, req, {modulo:'usuarios', accion:'editar', registroId:actual.id});
      }
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
      await registrarAuditoria(client, req, {modulo:'usuarios', accion:'cambiar_clave', registroId:actual.id});
      return {claveActualizada: true, sesionesRevocadas: true};
    });
  });

  // Eliminación física únicamente de cuentas de técnicos sin historial.
  // La acción revoca sus sesiones y deja una auditoría del administrador.
  // No se borran órdenes, evidencias, viáticos ni auditorías existentes.
  router.delete('/:id', async (req, res) => {
    return modificarTecnico(req, res, async (client, actual) => {
      if (await tieneHistorialTecnico(client, actual)) {
        rechazarHistorial('eliminar');
      }
      await client.query('DELETE FROM public.app_sesiones WHERE usuario_id=$1', [String(actual.id)]);
      const {rows: borrados} = await client.query(`
        DELETE FROM public.app_usuarios WHERE id=$1 AND rol='tecnico' RETURNING id
      `, [String(actual.id)]);
      if (borrados.length !== 1) {
        const e = new Error('No se pudo confirmar la eliminación.');
        e.code = 'DELETE_NOT_CONFIRMED';
        throw e;
      }
      await registrarAuditoria(client, req, {modulo:'usuarios', accion:'eliminar', registroId:actual.id});
      return {eliminado: true, id: String(actual.id), sesionesRevocadas: true};
    });
  });

  return router;
}

module.exports = {crearRouterAdminUsuarios};
