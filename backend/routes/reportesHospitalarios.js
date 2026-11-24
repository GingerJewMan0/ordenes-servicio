'use strict';
// Se monta SIN cambiar las rutas de órdenes ni viáticos.
// Reutiliza obligatoriamente el middleware requerirSesion del backend actual.
const { enviarPushNuevoReporteAdministradores } = require('../services/notificacionesPush');
const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

const TIPOS = new Set(['fuera_servicio','correctivo','preventivo','instalacion','apertura']);
const PRIORIDADES = new Set(['baja','media','alta','critica']);
const ESTADOS = new Set(['recibido','en_revision','asignado','programado','en_proceso','pendiente_refacciones','finalizado','cancelado']);
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function campo(value, max, min = 0) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.length < min || v.length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v)) return null;
  return v;
}
function validarReporte(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Formulario no válido.' };
  const p = {
    area: campo(body.area, 120, 2), equipo: campo(body.equipo, 160, 2),
    marca: campo(body.marca, 80), modelo: campo(body.modelo, 80),
    numero_serie: campo(body.numero_serie, 100), inventario: campo(body.inventario, 100),
    descripcion: campo(body.descripcion, 2000, 10),
    reportante: campo(body.reportante, 120, 3), contacto: campo(body.contacto, 150, 5),
    tipo: body.tipo, prioridad: body.prioridad
  };
  if (Object.values(p).some(v => v === null) || !TIPOS.has(p.tipo) || !PRIORIDADES.has(p.prioridad)) {
    return { error: 'Revisa los campos obligatorios y los tamaños permitidos.' };
  }
  return { value: p };
}

function crearRouterReportesHospitalarios({ pool, requerirSesion } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function' ||
      typeof requerirSesion !== 'function') {
    throw new Error('Faltan pool PostgreSQL o requerirSesion reales del backend.');
  }
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  const limiteConsulta = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60,
    standardHeaders: 'draft-7', legacyHeaders: false, message: {error:'Demasiadas solicitudes. Intenta más tarde.'} });
  const limiteEnvio = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12,
    standardHeaders: 'draft-7', legacyHeaders: false, message: {error:'Se alcanzó el límite temporal de reportes.'} });
  async function hospitalValido(token) {
    if (!TOKEN_REGEX.test(token || '')) return null;
    const {rows} = await pool.query(
      'SELECT id, nombre FROM public.hospitales_reportantes WHERE token_sha256 = $1 AND activo = TRUE',
      [hashToken(token)]
    );
    return rows[0] || null;
  }
  function fallar(res, error, contexto) {
    console.error(`[reportes-hospitalarios/${contexto}]`, error?.code || error?.name || 'error');
    return res.status(500).json({error:'No se pudo procesar la solicitud.'});
  }

  // Público: el QR SOLO identifica el hospital autorizado para ENVIAR.
  router.get('/publico/:token/hospital', limiteConsulta, async (req,res) => {
    try {
      const hospital = await hospitalValido(req.params.token);
      if (!hospital) return res.status(404).json({error:'Enlace inválido o desactivado.'});
      return res.json({nombre:hospital.nombre});
    } catch(e) { return fallar(res,e,'hospital'); }
  });
  router.post('/publico/:token', limiteEnvio, async (req,res) => {
    const resultado = validarReporte(req.body);
    if (resultado.error) return res.status(400).json({error:resultado.error});
    let client;
    try {
      const hospital = await hospitalValido(req.params.token);
      if (!hospital) return res.status(404).json({error:'Enlace inválido o desactivado.'});
      const p = resultado.value;
      client = await pool.connect();
      await client.query('BEGIN');
      // Comprobación bajo bloqueo: permite revocar un QR sin aceptar envíos concurrentes posteriores.
      const check = await client.query('SELECT id FROM public.hospitales_reportantes WHERE id=$1 AND activo=TRUE AND token_sha256=$2 FOR SHARE',
        [hospital.id, hashToken(req.params.token)]);
      if (!check.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({error:'Enlace desactivado.'}); }
      const r = await client.query(`INSERT INTO public.reportes_hospitalarios
        (hospital_id,area,equipo,marca,modelo,numero_serie,inventario,tipo,prioridad,descripcion,reportante,contacto)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,creado_en`,
        [hospital.id,p.area,p.equipo,p.marca,p.modelo,p.numero_serie,p.inventario,p.tipo,p.prioridad,p.descripcion,p.reportante,p.contacto]);
      const id = r.rows[0].id;
      const anio = new Date(r.rows[0].creado_en).getUTCFullYear();
      const folio = `REP-${anio}-${String(id).padStart(6,'0')}`;
      await client.query('UPDATE public.reportes_hospitalarios SET folio=$1 WHERE id=$2', [folio,id]);
      await client.query(`INSERT INTO public.reportes_hospitalarios_historial
        (reporte_id,estado_anterior,estado_nuevo,nota,actor) VALUES ($1,NULL,'recibido',NULL,'hospital')`, [id]);
      await client.query('COMMIT');
      // Notificar a los administradores después de guardar el reporte.
void enviarPushNuevoReporteAdministradores(pool, folio, id)
  .catch((error) => {
    console.error(
      '[push/nuevo-reporte]',
      error?.message || 'Error al enviar notificación'
    );
  });
      return res.status(201).json({folio,estado:'recibido',mensaje:'Reporte enviado correctamente.'});
    } catch(e) {
      if (client) { try { await client.query('ROLLBACK'); } catch(_) {} }
      return fallar(res,e,'crear');
    } finally { if (client) client.release(); }
  });

  // Todas las rutas /admin necesitan una sesión REAL y el rol admin.
  // Siempre protegido por seguridad.verificarSesionSiempre del server.js vigente.
  // No depende del modo de transición APP_AUTH_REQUIRED.
  router.use('/admin', requerirSesion, (req,res,next) => {
    if (!req.usuarioApp?.id) return res.status(401).json({error:'Sesión requerida.'});
    if (req.usuarioApp.rol !== 'admin') return res.status(403).json({error:'Solo administradores.'});
    next();
  });

  router.get('/admin', async (req,res) => {
    const estado = req.query.estado;
    if (estado && !ESTADOS.has(estado)) return res.status(400).json({error:'Estado no válido.'});
    const limit = 100;
    const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 100000);
    try {
      const sql = `SELECT r.id,r.folio,r.area,r.equipo,r.marca,r.modelo,r.numero_serie,r.inventario,
        r.tipo,r.prioridad,r.descripcion,r.reportante,r.contacto,r.estado,r.creado_en,r.actualizado_en,
        h.codigo AS hospital_codigo, h.nombre AS hospital
        FROM public.reportes_hospitalarios r JOIN public.hospitales_reportantes h ON h.id=r.hospital_id
        ${estado ? 'WHERE r.estado=$1' : ''} ORDER BY r.creado_en DESC,r.id DESC
        LIMIT ${limit} OFFSET $${estado?2:1}`;
      const {rows} = await pool.query(sql, estado ? [estado,offset] : [offset]);
      return res.json({reportes:rows,limit,offset});
    } catch(e) { return fallar(res,e,'listar-admin'); }
  });
  router.get('/admin/resumen', async (_req,res) => {
    try {
      const {rows}= await pool.query('SELECT estado,COUNT(*)::integer AS total FROM public.reportes_hospitalarios GROUP BY estado');
      return res.json({por_estado:rows, nuevos: rows.find(r => r.estado==='recibido')?.total || 0});
    } catch(e) { return fallar(res,e,'resumen-admin'); }
  });
  router.get('/admin/:id', async (req,res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({error:'ID inválido.'});
    try {
      const r=await pool.query(`SELECT r.*,h.codigo AS hospital_codigo,h.nombre AS hospital
        FROM public.reportes_hospitalarios r JOIN public.hospitales_reportantes h ON h.id=r.hospital_id WHERE r.id=$1`,[id]);
      if (!r.rows[0]) return res.status(404).json({error:'Reporte no encontrado.'});
      const h=await pool.query('SELECT estado_anterior,estado_nuevo,nota,actor,fecha FROM public.reportes_hospitalarios_historial WHERE reporte_id=$1 ORDER BY fecha ASC,id ASC',[id]);
      return res.json({reporte:r.rows[0],historial:h.rows});
    } catch(e) { return fallar(res,e,'detalle-admin'); }
  });
  router.patch('/admin/:id', async (req,res) => {
    const id = Number(req.params.id);
    const nuevoEstado = req.body?.estado;
    const nota = campo(req.body?.nota, 1000);
    if (!Number.isSafeInteger(id) || id < 1 || !ESTADOS.has(nuevoEstado) || nota === null ||
        (nuevoEstado === 'cancelado' && nota.length < 5)) {
      return res.status(400).json({error:'ID, estado o nota inválidos (la cancelación exige una nota).'});
    }
    let client;
    try {
      client=await pool.connect(); await client.query('BEGIN');
      const r=await client.query('SELECT estado FROM public.reportes_hospitalarios WHERE id=$1 FOR UPDATE',[id]);
      if (!r.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({error:'Reporte no encontrado.'}); }
      const anterior = r.rows[0].estado;
      if (['finalizado','cancelado'].includes(anterior) && anterior !== nuevoEstado) {
        await client.query('ROLLBACK'); return res.status(409).json({error:'No se puede cambiar un reporte cerrado.'});
      }
      if (anterior===nuevoEstado && !nota) { await client.query('ROLLBACK'); return res.status(400).json({error:'No hay cambios.'}); }
      await client.query('UPDATE public.reportes_hospitalarios SET estado=$1,actualizado_en=NOW() WHERE id=$2',[nuevoEstado,id]);
      await client.query(`INSERT INTO public.reportes_hospitalarios_historial
        (reporte_id,estado_anterior,estado_nuevo,nota,actor) VALUES ($1,$2,$3,$4,$5)`,
        [id,anterior,nuevoEstado,nota || null,String(req.usuarioApp.usuario || req.usuarioApp.id)]);
      await client.query('COMMIT');
      return res.json({ok:true,id,estado:nuevoEstado});
    } catch(e) { if (client) {try{await client.query('ROLLBACK')}catch(_){}} return fallar(res,e,'editar-admin'); }
    finally {if(client)client.release();}
  });
  return router;
}
module.exports = { crearRouterReportesHospitalarios, validarReporte, hashToken };
