'use strict';
// Evidencias de viáticos en bucket privado; nunca enviar SUPABASE_SECRET_KEY a Android.
// Rutas montadas bajo /api/viaticos/:id/comprobantes, con autorización en cada operación.
const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { registrarAuditoria } = require('../security/auditoria');

const MAX = 8 * 1024 * 1024;
const RUBROS = new Set(['casetas','estacionamiento','gasolina','hospedaje','comida','refacciones','material','otros']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID_CLIENTE = /^[a-zA-Z0-9_-]{8,100}$/;
const fechaValida = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x)) &&
  !Number.isNaN(Date.parse(`${x}T12:00:00Z`)) &&
  new Date(`${x}T12:00:00Z`).toISOString().slice(0, 10) === x;
const formatoFecha = x => x instanceof Date ? x.toISOString().slice(0,10) : String(x).slice(0,10);
const unico = (x) => !x || new Set(x).size === x.length;
const imagenReal = buf => {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX) return null;
  if (buf.length > 24 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buf.toString('ascii',12,16)==='IHDR') {
    return {mime:'image/png', ext:'png'};
  }
  if (buf.length > 4 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255 && buf.at(-2) === 255 && buf.at(-1) === 217) {
    return {mime:'image/jpeg', ext:'jpg'};
  }
  return null;
};
const subirArchivo = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:MAX, files:1, fields:3, parts:4, fieldSize:200},
  fileFilter(_req,file,cb) {
    if (!['image/jpeg','image/png'].includes(file.mimetype)) return cb(new Error('Formato no permitido'));
    cb(null,true);
  }
}).single('archivo');
const recibirArchivo = (req,res,next) => subirArchivo(req,res,err => {
  if (!err) return next();
  const grande = err.code === 'LIMIT_FILE_SIZE';
  return res.status(grande ? 413 : 400).json({error:grande?'La imagen supera 8 MB.':'Solo se aceptan imágenes JPG o PNG.'});
});

module.exports = function crearRouterComprobantesViaticos(pool) {
  if (!pool?.query || !pool?.connect) throw new Error('Se requiere Pool de PostgreSQL.');
  const router = express.Router({mergeParams:true});
  let cliente = null;
  let origenCliente = '';
  function almacenamiento() {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    const bucket = process.env.SUPABASE_BUCKET;
    if (!url || !secret || bucket !== 'viaticos-comprobantes') return null;
    try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
    const firma = `${url}\n${secret}\n${bucket}`;
    if (firma !== origenCliente) {
      cliente = createClient(url, secret, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      origenCliente = firma;
    }
    return cliente.storage.from(bucket);
  }
  const fallo = (res,e,operacion) => {
    console.error(`[viaticos-comprobantes/${operacion}]`, e?.code || e?.name || 'Error');
    if (e?.code === '23505') return res.status(409).json({error:'El comprobante ya está registrado.'});
    if (e?.code === '42P01' || e?.code === '42703') return res.status(503).json({error:'Falta instalar la migración SQL de comprobantes.'});
    return res.status(503).json({error:'No se pudo completar la operación. Consulta su estado antes de reintentar.'});
  };
  const respuesta = x => ({
    id:String(x.id), viaticoId:String(x.viatico_id), clientId:x.client_id,
    fecha:formatoFecha(x.fecha), concepto:x.concepto, mimeType:x.mime_type,
    tamanoBytes:x.tamano_bytes, sha256:String(x.sha256).trim(),
    creadoEn:x.creado_en, estado:x.estado
  });
  const validarCampos = (req, anterior=null) => {
    const fecha = req.body?.fecha == null && anterior ? formatoFecha(anterior.fecha) : String(req.body?.fecha ?? '');
    const concepto = req.body?.concepto == null && anterior ? anterior.concepto : String(req.body?.concepto ?? '');
    if (!fechaValida(fecha) || !RUBROS.has(concepto) || fecha < formatoFecha(req.viatico.fecha_inicio) || fecha > formatoFecha(req.viatico.fecha_fin)) {
      const e = new Error('Fecha o concepto no válido para el viático.');e.status = 400;throw e;
    }
    if (!req.file?.buffer?.length) {const e = new Error('Falta archivo.');e.status=400;throw e;}
    const img = imagenReal(req.file.buffer);
    if (!img || img.mime !== req.file.mimetype) {const e = new Error('El archivo no corresponde a JPG o PNG.');e.status=400;throw e;}
    return {fecha, concepto, img, sha256:crypto.createHash('sha256').update(req.file.buffer).digest('hex')};
  };
  const esAdmin = req => req.usuarioApp?.rol === 'admin';
  const protegerAdmin = (req,res,next) => esAdmin(req) ? next() : res.status(403).json({error:'Solo un administrador puede modificar comprobantes ya subidos.'});
  async function permisosCarga(req,res,next) {
    if (esAdmin(req)) return next();
    try {
      const {rows} = await pool.query('SELECT usuario_creador, estado FROM public.viaticos_captura_comprobantes WHERE viatico_id=$1',[req.viaticoId]);
      if (rows[0]?.estado !== 'pendiente' || rows[0]?.usuario_creador !== req.usuarioApp.usuario) {
        return res.status(403).json({error:'Solo puedes subir comprobantes iniciales de tus viáticos pendientes.'});
      }
      next();
    } catch(e){fallo(res,e,'permisos-carga');}
  }
  router.use((req,res,next) => {
    // Aunque otro middleware deje pasar sin token, estos archivos siempre son privados.
    if (process.env.APP_AUTH_REQUIRED !== 'true') return res.status(503).json({error:'La autenticación de viáticos debe estar activada.'});
    if (!req.usuarioApp) return res.status(401).json({error:'Inicia sesión para continuar.'});
    if (!['admin','tecnico'].includes(req.usuarioApp.rol)) return res.status(403).json({error:'Rol no autorizado.'});
    if (!/^\d+$/.test(String(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({error:'ID de viático inválido.'});
    req.viaticoId = String(req.params.id);
    next();
  });
  router.use(async(req,res,next) => {
    try {
      const {rows} = await pool.query('SELECT id,folio,fecha_inicio,fecha_fin FROM public.viaticos WHERE id=$1 AND eliminado_en IS NULL', [req.viaticoId]);
      if (!rows[0]) return res.status(404).json({error:'Viático no encontrado.'});
      req.viatico = rows[0];
      next();
    }catch(e){fallo(res,e,'viatico');}
  });
  router.get('/',async(req,res) => {
    try {
      const {rows} = await pool.query(`SELECT * FROM public.viaticos_comprobantes WHERE viatico_id=$1 AND estado='vigente' ORDER BY fecha,creado_en,id`,[req.viaticoId]);
      const captura = await pool.query('SELECT estado FROM public.viaticos_captura_comprobantes WHERE viatico_id=$1',[req.viaticoId]);
      res.set('Cache-Control','private, no-store');
      return res.json({viaticoId:req.viaticoId, estadoCaptura:captura.rows[0]?.estado ?? null, comprobantes:rows.map(respuesta)});
    } catch(e){fallo(res,e,'listar');}
  });
  router.get('/:comprobanteId',async(req,res) => {
    if (!UUID.test(req.params.comprobanteId)) return res.status(400).json({error:'ID de comprobante inválido.'});
    try {
      const {rows} = await pool.query(`SELECT * FROM public.viaticos_comprobantes WHERE viatico_id=$1 AND id=$2 AND estado='vigente'`, [req.viaticoId,req.params.comprobanteId]);
      const x=rows[0];
      if (!x) return res.status(404).json({error:'Comprobante no encontrado.'});
      const st=almacenamiento();
      if (!st) return res.status(503).json({error:'Storage privado no configurado.'});
      const {data,error} = await st.download(x.storage_path);
      if (error || !data) throw error || new Error('Archivo no disponible');
      const buf=Buffer.from(await data.arrayBuffer());
      if (buf.length !== x.tamano_bytes || crypto.createHash('sha256').update(buf).digest('hex') !== String(x.sha256).trim()) {
        return res.status(503).json({error:'El comprobante no superó la verificación de integridad.'});
      }
      res.set({'Content-Type':x.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
      return res.send(buf);
    } catch(e){fallo(res,e,'descargar');}
  });
  router.post('/', permisosCarga, recibirArchivo, async(req,res) => {
    let tx, subido = false, commitIntentado = false, ruta = '';
    try {
      const clientId = String(req.body?.clientId || '');
      if (!ID_CLIENTE.test(clientId)) return res.status(400).json({error:'clientId inválido o ausente.'});
      const {fecha,concepto,img,sha256}=validarCampos(req);
      const st=almacenamiento();
      if (!st) return res.status(503).json({error:'Storage privado no configurado.'});
      tx=await pool.connect();await tx.query('BEGIN');
      const {rows:c} = await tx.query('SELECT usuario_creador, estado FROM public.viaticos_captura_comprobantes WHERE viatico_id=$1 FOR UPDATE', [req.viaticoId]);
      if (!esAdmin(req) && (c[0]?.estado !== 'pendiente' || c[0]?.usuario_creador !== req.usuarioApp.usuario)) {
        await tx.query('ROLLBACK'); return res.status(403).json({error:'La captura está cerrada o no te pertenece.'});
      }
      const anterior=await tx.query('SELECT * FROM public.viaticos_comprobantes WHERE viatico_id=$1 AND client_id=$2', [req.viaticoId,clientId]);
      if (anterior.rows.length) {
        const x=anterior.rows[0];
        await tx.query('ROLLBACK');
        if (x.estado === 'vigente' && x.sha256.trim() === sha256 && formatoFecha(x.fecha) === fecha && x.concepto === concepto) {
          return res.status(200).json({comprobante:respuesta(x), repetido:true});
        }
        return res.status(409).json({error:'El identificador local ya corresponde a otro comprobante.'});
      }
      const id=crypto.randomUUID();ruta=`viaticos/${req.viaticoId}/${id}.${img.ext}`;
      const up=await st.upload(ruta,req.file.buffer,{contentType:img.mime,upsert:false,cacheControl:'0'});
      if (up.error) throw up.error;
      subido=true;
      const {rows} = await tx.query(`INSERT INTO public.viaticos_comprobantes
        (id,viatico_id,client_id,fecha,concepto,storage_path,mime_type,tamano_bytes,sha256,creado_por_usuario,creado_por_rol)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id,req.viaticoId,clientId,fecha,concepto,ruta,img.mime,req.file.buffer.length,sha256,req.usuarioApp.usuario,req.usuarioApp.rol]);
      await registrarAuditoria(tx,req,{modulo:'viaticos',accion:'crear',registroId:req.viaticoId,folio:req.viatico.folio});
      commitIntentado=true;await tx.query('COMMIT');
      return res.status(201).json({comprobante:respuesta(rows[0]),repetido:false});
    }catch(e){
      if (tx && !commitIntentado) await tx.query('ROLLBACK').catch(()=>{});
      if (subido && !commitIntentado) await almacenamiento()?.remove([ruta]).catch(()=>{});
      return e.status ? res.status(e.status).json({error:e.message}) : fallo(res,e,'subir');
    }finally{tx?.release();}
  });
  router.post('/finalizar',async(req,res) => {
    const ids=req.body?.clientIds;
    if (!Array.isArray(ids) || ids.length > 100 || !unico(ids) || !ids.every(x=>typeof x==='string' && ID_CLIENTE.test(x))) {
      return res.status(400).json({error:'Envía clientIds con identificadores locales únicos (puede ser []).'});
    }
    let tx;
    try {
      tx=await pool.connect();await tx.query('BEGIN');
      const r=await tx.query('SELECT * FROM public.viaticos_captura_comprobantes WHERE viatico_id=$1 FOR UPDATE',[req.viaticoId]);
      const c=r.rows[0];
      if (!c) {await tx.query('ROLLBACK');return res.status(404).json({error:'Captura inicial no disponible para este viático antiguo.'});}
      if (!esAdmin(req) && c.usuario_creador !== req.usuarioApp.usuario) {await tx.query('ROLLBACK');return res.status(403).json({error:'Captura de otro usuario.'});}
      if (c.estado==='cerrada') {await tx.query('ROLLBACK');return res.json({finalizada:true,yaEstabaCerrada:true});}
      const activos=await tx.query(`SELECT client_id FROM public.viaticos_comprobantes WHERE viatico_id=$1 AND estado='vigente'`,[req.viaticoId]);
      const existentes=activos.rows.map(x=>x.client_id).filter(Boolean);
      if (existentes.length!==ids.length || !existentes.every(x=>ids.includes(x))) {
        await tx.query('ROLLBACK');return res.status(409).json({error:'Aún hay comprobantes sin sincronizar, sobrantes o ya modificados.'});
      }
      await tx.query(`UPDATE public.viaticos_captura_comprobantes SET estado='cerrada', cerrada_en=now() WHERE viatico_id=$1`,[req.viaticoId]);
      await registrarAuditoria(tx,req,{modulo:'viaticos',accion:'editar',registroId:req.viaticoId,folio:req.viatico.folio});
      await tx.query('COMMIT');
      return res.json({finalizada:true});
    }catch(e){if(tx)await tx.query('ROLLBACK').catch(()=>{});return fallo(res,e,'finalizar');}
    finally{tx?.release();}
  });
  router.put('/:comprobanteId', protegerAdmin, recibirArchivo, async(req,res) => {
    if (!UUID.test(req.params.comprobanteId)) return res.status(400).json({error:'ID de comprobante inválido.'});
    let tx, ruta='',subido=false,commitIntentado=false;
    try {
      const st=almacenamiento();if (!st) return res.status(503).json({error:'Storage privado no configurado.'});
      tx=await pool.connect();await tx.query('BEGIN');
      await tx.query('SELECT id FROM public.viaticos WHERE id=$1 FOR UPDATE',[req.viaticoId]);
      const {rows}=await tx.query(`SELECT * FROM public.viaticos_comprobantes WHERE viatico_id=$1 AND id=$2 AND estado='vigente' FOR UPDATE`,[req.viaticoId,req.params.comprobanteId]);
      if(!rows[0]) {await tx.query('ROLLBACK');return res.status(404).json({error:'Comprobante no encontrado o ya reemplazado.'});}
      const {fecha,concepto,img,sha256}=validarCampos(req,rows[0]);
      const id=crypto.randomUUID(); ruta=`viaticos/${req.viaticoId}/${id}.${img.ext}`;
      const up=await st.upload(ruta,req.file.buffer,{contentType:img.mime,upsert:false,cacheControl:'0'});
      if (up.error) throw up.error;subido=true;
      await tx.query(`UPDATE public.viaticos_comprobantes SET estado='reemplazado', cambiado_por_usuario=$3, cambiado_en=now() WHERE id=$1 AND viatico_id=$2`,[req.params.comprobanteId,req.viaticoId,req.usuarioApp.usuario]);
      const r=await tx.query(`INSERT INTO public.viaticos_comprobantes
        (id,viatico_id,fecha,concepto,storage_path,mime_type,tamano_bytes,sha256,creado_por_usuario,creado_por_rol,reemplaza_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id,req.viaticoId,fecha,concepto,ruta,img.mime,req.file.buffer.length,sha256,req.usuarioApp.usuario,'admin',req.params.comprobanteId]);
      await registrarAuditoria(tx,req,{modulo:'viaticos',accion:'editar',registroId:req.viaticoId,folio:req.viatico.folio});
      commitIntentado=true;await tx.query('COMMIT');
      return res.json({comprobante:respuesta(r.rows[0]),reemplazadoId:req.params.comprobanteId});
    }catch(e){
      if(tx && !commitIntentado) await tx.query('ROLLBACK').catch(()=>{});
      if(subido && !commitIntentado) await almacenamiento()?.remove([ruta]).catch(()=>{});
      return e.status ? res.status(e.status).json({error:e.message}) : fallo(res,e,'reemplazar');
    }finally{tx?.release();}
  });
  router.delete('/:comprobanteId',protegerAdmin,async(req,res) => {
    if(!UUID.test(req.params.comprobanteId)) return res.status(400).json({error:'ID de comprobante inválido.'});
    let tx;
    try {
      tx=await pool.connect();await tx.query('BEGIN');
      await tx.query('SELECT id FROM public.viaticos WHERE id=$1 FOR UPDATE',[req.viaticoId]);
      const r=await tx.query(`UPDATE public.viaticos_comprobantes SET estado='eliminado', cambiado_por_usuario=$3, cambiado_en=now()
        WHERE viatico_id=$1 AND id=$2 AND estado='vigente' RETURNING id`,[req.viaticoId,req.params.comprobanteId,req.usuarioApp.usuario]);
      if(!r.rows.length){await tx.query('ROLLBACK');return res.status(404).json({error:'Comprobante no encontrado o ya eliminado.'});}
      await registrarAuditoria(tx,req,{modulo:'viaticos',accion:'eliminar',registroId:req.viaticoId,folio:req.viatico.folio});
      await tx.query('COMMIT');
      return res.json({eliminado:true,conservadoParaAuditoria:true});
    }catch(e){if(tx)await tx.query('ROLLBACK').catch(()=>{});return fallo(res,e,'eliminar');}
    finally{tx?.release();}
  });
  return router;
};
