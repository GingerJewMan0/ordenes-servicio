'use strict';
// Router ADITIVO; NO reemplaza reportesHospitalarios.js ni cambia rutas existentes.
const express = require('express');
const { enviarPushAsignacion } = require('../services/notificacionesPush');

const TECNICO = 'tecnico';
const ESTADOS_TECNICO = new Set(['en_proceso', 'pendiente_refacciones', 'finalizado']);
const TRANSICIONES = {
  asignado: ['en_proceso'],
  programado: ['en_proceso'],
  en_proceso: ['pendiente_refacciones', 'finalizado'],
  pendiente_refacciones: ['en_proceso', 'finalizado']
};
function idReporte(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function texto(value, max = 1000) {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : null;
}
function idUsuario(value) {
  const v = String(value ?? '').trim();
  return /^(?:[1-9][0-9]{0,18}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.test(v) ? v : null;
}
function crearRouterAsignacionesHospitalarias(pool, verificarSesionSiempre) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function' || typeof verificarSesionSiempre !== 'function') {
    throw new Error('Las asignaciones requieren Pool y validación de sesión REAL.');
  }
  const r = express.Router();
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  r.use(verificarSesionSiempre);
  const soloAdmin = (req,res,next) => req.usuarioApp?.rol === 'admin'
    ? next() : res.status(403).json({error:'Solo administradores.'});
  const soloTecnico = (req,res,next) => req.usuarioApp?.rol === TECNICO
    ? next() : res.status(403).json({error:'Solo técnicos.'});
  function fallo(res,e,contexto) {
    console.error(`[asignaciones/${contexto}]`, e?.code || e?.name || 'error');
    return res.status(500).json({error:'No fue posible completar la operación.'});
  }

  // ADMIN: sólo usuarios reales activos de tipo técnico.
  r.get('/admin/tecnicos', soloAdmin, async (_req,res) => {
    try {
      const {rows}=await pool.query(`SELECT id::text AS id, usuario
         FROM public.app_usuarios WHERE activo=TRUE AND rol=$1 ORDER BY usuario ASC`, [TECNICO]);
      res.json({tecnicos: rows});
    } catch(e) { fallo(res,e,'tecnicos'); }
  });
  r.get('/admin/:id/asignacion', soloAdmin, async (req,res) => {
    const id = idReporte(req.params.id);
    if (!id) return res.status(400).json({error:'Reporte inválido.'});
    try {
      const {rows}=await pool.query(`SELECT a.tecnico_id::text AS tecnico_id, u.usuario AS tecnico,
       a.asignado_por_id::text AS asignado_por_id, a.asignado_en, a.actualizado_en
       FROM public.reportes_hospitalarios_asignaciones a
       JOIN public.app_usuarios u ON u.id=a.tecnico_id WHERE a.reporte_id=$1`, [id]);
      res.json({asignacion: rows[0] || null});
    } catch(e) { fallo(res,e,'asignacion'); }
  });

  r.post('/admin/:id/asignar', soloAdmin, async (req,res) => {
    const id = idReporte(req.params.id);
    const tecnicoId = idUsuario(req.body?.tecnico_id);
    const nota = texto(req.body?.nota, 500);
    if (!id || !tecnicoId || nota === null) return res.status(400).json({error:'Folio, técnico o nota inválidos.'});
    let c;
    try {
      c = await pool.connect();
      await c.query('BEGIN');
      const {rows: reportes} = await c.query(`SELECT r.id,r.folio,r.estado,h.nombre AS hospital
        FROM public.reportes_hospitalarios r JOIN public.hospitales_reportantes h ON h.id=r.hospital_id
        WHERE r.id=$1 FOR UPDATE OF r`, [id]);
      const reporte = reportes[0];
      if (!reporte) {await c.query('ROLLBACK'); return res.status(404).json({error:'Reporte no encontrado.'});}
      if (['cancelado','finalizado'].includes(reporte.estado)) {
        await c.query('ROLLBACK'); return res.status(409).json({error:'El reporte ya está cerrado.'});
      }
      const {rows: usuarios}=await c.query(`SELECT id,usuario FROM public.app_usuarios
         WHERE id::text=$1 AND rol=$2 AND activo=TRUE LIMIT 1`, [tecnicoId,TECNICO]);
      const tecnico=usuarios[0];
      if (!tecnico) {await c.query('ROLLBACK'); return res.status(400).json({error:'Selecciona un técnico activo.'});}
      const {rows: previos}=await c.query(`SELECT tecnico_id::text AS tecnico_id
          FROM public.reportes_hospitalarios_asignaciones WHERE reporte_id=$1 FOR UPDATE`,[id]);
      const previo=previos[0]?.tecnico_id;
      if (previo === String(tecnico.id)) {
        await c.query('ROLLBACK'); return res.status(409).json({error:'Este reporte ya está asignado a ese técnico.'});
      }
      const nuevoEstado = ['recibido','en_revision','programado','asignado'].includes(reporte.estado)
        ? 'asignado' : reporte.estado;
      await c.query(`INSERT INTO public.reportes_hospitalarios_asignaciones
        (reporte_id,tecnico_id,asignado_por_id) VALUES ($1,$2,$3)
        ON CONFLICT(reporte_id) DO UPDATE SET tecnico_id=EXCLUDED.tecnico_id,
          asignado_por_id=EXCLUDED.asignado_por_id,asignado_en=NOW(),actualizado_en=NOW()`,
        [id,tecnico.id,req.usuarioApp.id]);
      await c.query(`UPDATE public.reportes_hospitalarios SET estado=$2, actualizado_en=NOW() WHERE id=$1`,[id,nuevoEstado]);
      await c.query(`INSERT INTO public.reportes_hospitalarios_historial
        (reporte_id,estado_anterior,estado_nuevo,nota,actor) VALUES($1,$2,$3,$4,$5)`,
        [id,reporte.estado,nuevoEstado,`Técnico asignado: ${tecnico.usuario}.${nota?' '+nota:''}`,String(req.usuarioApp.usuario || req.usuarioApp.id)]);
      // La bandeja de avisos se crea en la MISMA transacción que la asignación.
      const titulo = previo ? 'Reporte reasignado a ti' : 'Nuevo reporte asignado';
      const mensaje = `Se te asignó el reporte ${reporte.folio} de ${reporte.hospital}.`;
      await c.query(`INSERT INTO public.reportes_hospitalarios_notificaciones
        (usuario_id,reporte_id,titulo,mensaje) VALUES ($1,$2,$3,$4)`,[tecnico.id,id,titulo,mensaje]);
      // Evitar que el técnico anterior vea un aviso obsoleto como pendiente.
      if (previo) await c.query(`UPDATE public.reportes_hospitalarios_notificaciones SET leida_en=NOW()
        WHERE reporte_id=$1 AND usuario_id::text=$2 AND leida_en IS NULL`,[id,previo]);
      await c.query('COMMIT');
      // Enviar notificación después de guardar la asignación.
      void enviarPushAsignacion(pool, tecnico.id, reporte.folio, id)
        .catch(e => {
          console.error('[push/asignacion]', e?.message || 'error');
        });
      return res.json({ok:true,folio:reporte.folio,tecnico:tecnico.usuario,estado:nuevoEstado,aviso_creado:true});
    } catch(e) {
      if(c){try{await c.query('ROLLBACK');}catch(_){}}
      return fallo(res,e,'asignar');
    } finally {if(c)c.release();}
  });

  r.get('/mis/notificaciones', soloTecnico, async (req,res) => {
    try {
      const {rows}=await pool.query(`SELECT n.id,n.reporte_id,r.folio,n.titulo,n.mensaje,n.creada_en,
          n.leida_en FROM public.reportes_hospitalarios_notificaciones n
          JOIN public.reportes_hospitalarios r ON r.id=n.reporte_id
          WHERE n.usuario_id=$1 ORDER BY n.creada_en DESC,n.id DESC LIMIT 60`, [req.usuarioApp.id]);
      res.json({notificaciones:rows,no_leidas:rows.filter(n=>!n.leida_en).length});
    } catch(e) {fallo(res,e,'avisos');}
  });
  r.patch('/mis/notificaciones/:id/leer', soloTecnico, async (req,res) => {
    const id=idReporte(req.params.id);
    if(!id) return res.status(400).json({error:'Aviso inválido.'});
    try {
      const {rowCount}=await pool.query(`UPDATE public.reportes_hospitalarios_notificaciones
        SET leida_en=COALESCE(leida_en,NOW()) WHERE id=$1 AND usuario_id=$2`,[id,req.usuarioApp.id]);
      if(!rowCount) return res.status(404).json({error:'Aviso no encontrado.'});
      res.json({ok:true});
    } catch(e){fallo(res,e,'leer-aviso');}
  });

  r.get('/mis', soloTecnico, async (req,res) => {
    try {
      const {rows}=await pool.query(`SELECT r.id,r.folio,r.estado,r.tipo,r.prioridad,r.area,r.equipo,
          r.creado_en,r.actualizado_en,h.nombre AS hospital,a.asignado_en
         FROM public.reportes_hospitalarios_asignaciones a
         JOIN public.reportes_hospitalarios r ON r.id=a.reporte_id
         JOIN public.hospitales_reportantes h ON h.id=r.hospital_id
         WHERE a.tecnico_id=$1 ORDER BY a.actualizado_en DESC,r.id DESC LIMIT 100`,[req.usuarioApp.id]);
      res.json({reportes:rows});
    } catch(e){fallo(res,e,'mis-reportes');}
  });
  r.get('/mis/:id', soloTecnico, async (req,res) => {
    const id=idReporte(req.params.id);
    if(!id) return res.status(400).json({error:'Reporte inválido.'});
    try {
      const {rows}=await pool.query(`SELECT r.*,h.nombre AS hospital,a.asignado_en
          FROM public.reportes_hospitalarios r JOIN public.hospitales_reportantes h ON h.id=r.hospital_id
          JOIN public.reportes_hospitalarios_asignaciones a ON a.reporte_id=r.id
          WHERE r.id=$1 AND a.tecnico_id=$2`,[id,req.usuarioApp.id]);
      if(!rows[0])return res.status(404).json({error:'Reporte no asignado a tu cuenta.'});
      const h=await pool.query(`SELECT estado_anterior,estado_nuevo,nota,actor,fecha
          FROM public.reportes_hospitalarios_historial WHERE reporte_id=$1 ORDER BY fecha ASC,id ASC`,[id]);
      res.json({reporte:rows[0],historial:h.rows});
    } catch(e){fallo(res,e,'mi-detalle');}
  });
  r.patch('/mis/:id/estado', soloTecnico, async (req,res) => {
    const id=idReporte(req.params.id);
    const estado=req.body?.estado;
    const nota=texto(req.body?.nota,1000);
    if(!id || !ESTADOS_TECNICO.has(estado) || nota===null) return res.status(400).json({error:'Estado o nota inválidos.'});
    if(['pendiente_refacciones','finalizado'].includes(estado) && nota.length<10)
      return res.status(400).json({error:'Escribe una nota de al menos 10 caracteres para ese estado.'});
    let c;
    try {
      c=await pool.connect(); await c.query('BEGIN');
      const {rows}=await c.query(`SELECT r.estado FROM public.reportes_hospitalarios r
         JOIN public.reportes_hospitalarios_asignaciones a ON a.reporte_id=r.id
         WHERE r.id=$1 AND a.tecnico_id=$2 FOR UPDATE OF r`,[id,req.usuarioApp.id]);
      if(!rows[0]) {await c.query('ROLLBACK');return res.status(404).json({error:'Reporte no asignado a tu cuenta.'});}
      const anterior=rows[0].estado;
      if(!(TRANSICIONES[anterior]||[]).includes(estado)) {
        await c.query('ROLLBACK'); return res.status(409).json({error:`No puedes cambiar un reporte de ${anterior} a ${estado}.`});
      }
      await c.query(`UPDATE public.reportes_hospitalarios SET estado=$1,actualizado_en=NOW() WHERE id=$2`,[estado,id]);
      await c.query(`INSERT INTO public.reportes_hospitalarios_historial
        (reporte_id,estado_anterior,estado_nuevo,nota,actor) VALUES ($1,$2,$3,$4,$5)`,
        [id,anterior,estado,nota||null,String(req.usuarioApp.usuario||req.usuarioApp.id)]);
      await c.query('COMMIT');
      res.json({ok:true,id,estado});
    } catch(e){if(c){try{await c.query('ROLLBACK');}catch(_){}}fallo(res,e,'estado-tecnico');}
    finally{if(c)c.release();}
  });
  return r;
}
module.exports={crearRouterAsignacionesHospitalarias};
