'use strict';
// Auth con sesiones aleatorias revocables guardadas como hash SHA-256 en PostgreSQL.
// MONTAR en ambos servicios (órdenes y viáticos) con la misma DATABASE_URL.
const express = require('express');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const DURACION_HORAS = 12;
const REGEX_USUARIO = /^[a-z0-9._-]{3,80}$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
async function verificarClave(clave, hashAlmacenado) {
  const partes = String(hashAlmacenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, sal, esperadoHex] = partes;
  const N = Number(n), R = Number(r), P = Number(p);
  if (N !== 16384 || R !== 8 || P !== 1 || !/^[a-f0-9]{32}$/.test(sal) || !/^[a-f0-9]{128}$/.test(esperadoHex)) return false;
  const real = await scrypt(clave, Buffer.from(sal, 'hex'), 64, {N, r: R, p: P, maxmem: 64 * 1024 * 1024});
  const esperado = Buffer.from(esperadoHex, 'hex');
  return crypto.timingSafeEqual(real, esperado);
}

function crearSeguridad(pool) {
  const router = express.Router();
  router.use(express.json({limit: '10kb'}));
  // Límite elemental para una sola instancia. Para escalar a varias, usar un
  // rate limiter centralizado (Redis / proveedor de identidad).
  const intentos = new Map();
  const ventanaMs = 15 * 60 * 1000;
  const maxIntentos = 8;
  const sinAuth = process.env.APP_AUTH_REQUIRED === 'false';
  if (sinAuth) console.warn('SEGURIDAD DESACTIVADA TEMPORALMENTE: APP_AUTH_REQUIRED=false');

  function error(res, err, nombre) {
    console.error(`[auth/${nombre}]`, err?.code || err?.message || 'error');
    return res.status(503).json({error: 'Autenticación temporalmente no disponible.'});
  }

  async function autenticar(req, res, next) {
    try {
      const cabecera = String(req.get('authorization') || '');
      const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(cabecera);
      if (!match) return res.status(401).json({error: 'Inicia sesión para continuar.'});
      const tokenHash = hashToken(match[1]);
      const {rows} = await pool.query(`
        SELECT s.id AS sesion_id, u.id, u.usuario, u.rol
        FROM public.app_sesiones s
        JOIN public.app_usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = $1
          AND s.revocado_en IS NULL AND s.vence_en > NOW() AND u.activo = TRUE
        LIMIT 1
      `, [tokenHash]);
      if (!rows[0]) return res.status(401).json({error: 'La sesión caducó. Inicia sesión nuevamente.'});
      req.usuarioApp = rows[0];
      req.sesionHash = tokenHash;
      next();
    } catch (err) {
      error(res, err, 'verificar');
    }
  }

  function requerirSesion(req, res, next) {
    if (sinAuth) return next(); // SOLO para transición antes de actualizar todos los APK.
    return autenticar(req, res, next);
  }
  function soloAdmin(req, res, next) {
    if (sinAuth) return next();
    if (!req.usuarioApp) return res.status(401).json({error: 'Inicia sesión para continuar.'});
    if (req.usuarioApp.rol !== 'admin') return res.status(403).json({error: 'Esta acción requiere una cuenta administradora.'});
    next();
  }

  router.post('/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'desconocido';
    const ahora = Date.now();
    // Expulsar entradas antiguas para evitar crecimiento indefinido.
    if (intentos.size > 10000) for (const [k, v] of intentos) if (v.hasta < ahora) intentos.delete(k);
    const intento = intentos.get(ip);
    if (intento && intento.hasta > ahora && intento.numero >= maxIntentos) {
      res.set('Retry-After', String(Math.ceil((intento.hasta - ahora) / 1000)));
      return res.status(429).json({error: 'Demasiados intentos. Prueba más tarde.'});
    }
    const usuario = String(req.body?.usuario || '').trim().toLowerCase();
    const clave = req.body?.clave;
    if (!REGEX_USUARIO.test(usuario) || typeof clave !== 'string' || clave.length < 1 || clave.length > 512) {
      return res.status(400).json({error: 'Usuario o contraseña inválidos.'});
    }
    try {
      const {rows} = await pool.query('SELECT id, usuario, clave_hash, rol FROM public.app_usuarios WHERE usuario = $1 AND activo = TRUE', [usuario]);
      const valido = rows[0] ? await verificarClave(clave, rows[0].clave_hash) : false;
      if (!valido) {
        const anterior = intento?.hasta > ahora ? intento.numero : 0;
        intentos.set(ip, {numero: anterior + 1, hasta: ahora + ventanaMs});
        return res.status(401).json({error: 'Usuario o contraseña incorrectos.'});
      }
      intentos.delete(ip);
      const token = crypto.randomBytes(48).toString('base64url');
      const vencimiento = new Date(ahora + DURACION_HORAS * 60 * 60 * 1000).toISOString();
      await pool.query('DELETE FROM public.app_sesiones WHERE vence_en <= NOW() OR revocado_en IS NOT NULL');
      await pool.query('INSERT INTO public.app_sesiones (usuario_id, token_hash, vence_en) VALUES ($1, $2, $3)', [rows[0].id, hashToken(token), vencimiento]);
      return res.json({token, venceEn: vencimiento, usuario: {id: String(rows[0].id), usuario: rows[0].usuario, rol: rows[0].rol}});
    } catch (err) { return error(res, err, 'login'); }
  });

  router.get('/me', autenticar, (req, res) => {
    const {id, usuario, rol} = req.usuarioApp;
    res.json({usuario: {id: String(id), usuario, rol}});
  });
  router.post('/logout', autenticar, async (req, res) => {
    try {
      await pool.query('DELETE FROM public.app_sesiones WHERE token_hash = $1', [req.sesionHash]);
      res.json({sesionCerrada: true});
    } catch (err) { error(res, err, 'logout'); }
  });
  return {router, requerirSesion, soloAdmin, verificarSesionSiempre: autenticar};
}

module.exports = {crearSeguridad};
