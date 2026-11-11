// Viáticos por semana: un folio, gastos y hospitales por fecha.
// Montar con app.use('/api/viaticos', crearRouterViaticos(pool)).
// ATENCIÓN: la API original no tiene autenticación. No almacenar comprobantes
// con datos personales en el servidor antes de implementar sesiones/permisos.
const express = require('express');
const RUBROS = ['casetas', 'estacionamiento', 'gasolina', 'hospedaje', 'comida', 'refacciones', 'material', 'otros'];
const CAMPOS = ['empresa_id', 'empleado', 'destino', 'fecha_inicio', 'fecha_fin', 'orden_relacionada', 'motivo', 'observaciones', ...RUBROS];
const COLUMNAS = ['id','folio','client_request_id', ...CAMPOS,'total','creado_en','actualizado_en','eliminado_en'].join(', ');
const DIAS_COLUMNAS = ['viatico_id','fecha','hospitales','proyecto',...RUBROS];
const texto = (v, largo) => String(v ?? '').trim().slice(0, largo);
const yyyyMMdd = (v) => v instanceof Date ? v.toISOString().slice(0,10) : String(v).slice(0,10);
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) &&
  !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0,10) === v;
const fechaMasDias = (v, cantidad) => {
  const d = new Date(`${v}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + cantidad);
  return d.toISOString().slice(0,10);
};
function importe(v, nombre) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 9999999999.99 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    const e = new Error(`Importe inválido en ${nombre}.`); e.status = 400; throw e;
  }
  return n.toFixed(2);
}
function validar(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const e = new Error('Datos inválidos.'); e.status = 400; throw e;
  }
  const d = {
    empresa_id: texto(body.empresaId,30) || 'general', empleado: texto(body.empleado,180),
    destino: texto(body.destino,250), fecha_inicio: texto(body.fechaInicio,10),
    fecha_fin: texto(body.fechaFin,10), orden_relacionada: texto(body.ordenRelacionada,50),
    motivo: texto(body.motivo,4000), observaciones: texto(body.observaciones,4000)
  };
  const mal = (mensaje) => { const error = new Error(mensaje); error.status = 400; throw error; };
  if (!['opciones','mexus','general'].includes(d.empresa_id)) mal('Empresa inválida.');
  if (!d.empleado || !d.destino || !d.motivo) mal('Completa empleado, destino y motivo.');
  if (!esFecha(d.fecha_inicio) || !esFecha(d.fecha_fin) || d.fecha_fin < d.fecha_inicio) mal('Fechas inválidas.');
  let dias = null;
  if (body.dias !== undefined) {
    if (!Array.isArray(body.dias) || body.dias.length < 5 || body.dias.length > 7) mal('El desglose debe contener 5 a 7 días de la misma semana.');
    if (new Date(`${d.fecha_inicio}T12:00:00Z`).getUTCDay() !== 1) mal('La semana debe comenzar en lunes.');
    const finalSemana = fechaMasDias(d.fecha_inicio, 6);
    const fechasVistas = new Set();
    dias = body.dias.map((item) => {
      const fecha = texto(item?.fecha,10);
      if (!esFecha(fecha) || fecha < d.fecha_inicio || fecha > finalSemana || fechasVistas.has(fecha)) mal('Días repetidos o fuera de la semana seleccionada.');
      fechasVistas.add(fecha);
      return { fecha, hospitales: texto(item?.hospitales,500), proyecto: texto(item?.proyecto,500),
        gastos: Object.fromEntries(RUBROS.map(r=>[r, importe(item?.gastos?.[r], `${r} (${fecha})`)])) };
    }).sort((a,b)=>a.fecha.localeCompare(b.fecha));
    for (let i=0;i<5;i++) if (!fechasVistas.has(fechaMasDias(d.fecha_inicio,i))) mal('Lunes a viernes deben aparecer en el desglose.');
    if (d.fecha_fin !== dias[dias.length - 1].fecha) mal('La fecha final no coincide con los días incluidos.');
    RUBROS.forEach(r=>{ d[r] = (dias.reduce((c,dia)=>c+Math.round(Number(dia.gastos[r])*100),0)/100).toFixed(2); });
  } else {
    // Compatibilidad con APK anterior: no inventamos qué día corresponde al gasto.
    RUBROS.forEach(r=>{ d[r] = importe(body.gastos?.[r],r); });
  }
  return {datos:d,dias};
}
function presentar(fila, dias) {
  const gastos = Object.fromEntries(RUBROS.map(r=>[r,Number(fila[r])]));
  return { id:String(fila.id), folio:fila.folio, empresaId:fila.empresa_id,
    empleado:fila.empleado, destino:fila.destino,
    fechaInicio:yyyyMMdd(fila.fecha_inicio), fechaFin:yyyyMMdd(fila.fecha_fin),
    ordenRelacionada:fila.orden_relacionada,motivo:fila.motivo,
    observaciones:fila.observaciones,gastos,total:Number(fila.total),
    dias:dias||[],creadoEn:fila.creado_en,actualizadoEn:fila.actualizado_en,origen:'servidor' };
}
const presentarDia = (fila) => ({ fecha:yyyyMMdd(fila.fecha), hospitales:fila.hospitales, proyecto:fila.proyecto || '',
  gastos:Object.fromEntries(RUBROS.map(r=>[r,Number(fila[r])])) });
async function leerDias(client, ids) {
  const m = new Map();
  if (!ids.length) return m;
  const {rows} = await client.query(
    `SELECT ${DIAS_COLUMNAS.join(',')} FROM public.viaticos_dias WHERE viatico_id = ANY($1::bigint[]) ORDER BY fecha`,
    [ids.map(String)]);
  for (const r of rows) {
    const k = String(r.viatico_id);
    if (!m.has(k)) m.set(k,[]);
    m.get(k).push(presentarDia(r));
  }
  return m;
}
async function guardarDias(client, id, dias) {
  await client.query('DELETE FROM public.viaticos_dias WHERE viatico_id = $1',[id]);
  if (!dias) return;
  for (const dia of dias) {
    const valores = [id,dia.fecha,dia.hospitales,dia.proyecto,...RUBROS.map(r=>dia.gastos[r])];
    await client.query(`INSERT INTO public.viaticos_dias (${DIAS_COLUMNAS.join(',')}) VALUES (${valores.map((_,i)=>`$${i+1}`).join(',')})`,valores);
  }
}
module.exports = function crearRouterViaticos(pool) {
  const router = express.Router();
  router.use(express.json({limit:'100kb'}));
  // Registro técnico: no incluye nombres, importes, fotografías ni cuerpos JSON.
  router.use((req,res,next)=>{
    const inicio=Date.now();
    res.on('finish',()=>console.log(`[viaticos] ${req.method} ${req.path} HTTP ${res.statusCode} ${Date.now()-inicio}ms`));
    next();
  });
  const errorHTTP = (res,e) => {
    if (e.status) return res.status(e.status).json({error:e.message});
    if (e.code === '23505') return res.status(409).json({error:'Folio o identificador duplicado.'});
    if (e.code === '42P01' || e.code === '42703') return res.status(503).json({error:'La estructura PostgreSQL no coincide con el backend. Comprueba las migraciones.'});
    if (['08000','08003','08006','57P01','53300','ECONNREFUSED','ETIMEDOUT'].includes(e.code)) {
      console.error('Fallo de conexión de viáticos a PostgreSQL:',e.code);
      return res.status(503).json({error:'No se pudo conectar con PostgreSQL. Comprueba el estado de Render.'});
    }
    // No registrar datos personales ni el cuerpo de la solicitud.
    console.error('Error interno de viáticos:',{codigo:e.code||'SIN_CODIGO',nombre:e.name||'Error'});
    return res.status(500).json({error:'Error del servidor al guardar o consultar viáticos.'});
  };
  router.get('/',async (_req,res)=>{
    try {
      const {rows} = await pool.query(`SELECT ${COLUMNAS} FROM public.viaticos WHERE eliminado_en IS NULL ORDER BY creado_en DESC,id DESC LIMIT 200`);
      const dias = await leerDias(pool,rows.map(r=>r.id));
      res.json({viaticos:rows.map(r=>presentar(r,dias.get(String(r.id))||[]))});
    } catch(e) { errorHTTP(res,e); }
  });
  // Verificar si un POST quedó guardado cuando la respuesta se perdió.
  // El identificador no se reutiliza entre solicitudes distintas.
  router.get('/solicitud/:identificador',async(req,res)=>{
    try{
      const identificador=texto(req.params.identificador,100);
      if(!/^[A-Za-z0-9_-]{8,100}$/.test(identificador))return res.status(400).json({error:'Identificador de solicitud inválido.'});
      const {rows}=await pool.query(`SELECT ${COLUMNAS} FROM public.viaticos WHERE client_request_id=$1 AND eliminado_en IS NULL LIMIT 1`,[identificador]);
      if(!rows.length)return res.status(404).json({error:'Aún no se encontró esta solicitud.'});
      const dias=await leerDias(pool,[rows[0].id]);
      return res.json({viatico:presentar(rows[0],dias.get(String(rows[0].id))||[])});
    }catch(e){errorHTTP(res,e);}
  });
  router.post('/',async (req,res)=>{
    let client;
    try {
      client=await pool.connect();
      const {datos,dias}=validar(req.body);
      const peticion=texto(req.body.clientRequestId,100);
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(peticion)) { const e=new Error('Identificador de solicitud inválido.');e.status=400;throw e; }
      await client.query('BEGIN');
      const columnas=['client_request_id',...CAMPOS];
      const valores=[peticion,...CAMPOS.map(c=>datos[c])];
      const insert=await client.query(`INSERT INTO public.viaticos (${columnas.join(',')}) VALUES (${valores.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT (client_request_id) DO NOTHING RETURNING ${COLUMNAS}`,valores);
      let fila=insert.rows[0];
      if (fila) await guardarDias(client,fila.id,dias);
      else {
        const existente=await client.query(`SELECT ${COLUMNAS} FROM public.viaticos WHERE client_request_id=$1`,[peticion]);
        fila=existente.rows[0];
        if (!fila || fila.eliminado_en) {const e=new Error('Solicitud repetida o eliminada.');e.status=409;throw e;}
      }
      const agrupados=await leerDias(client,[fila.id]);
      await client.query('COMMIT');
      res.status(insert.rows.length?201:200).json({viatico:presentar(fila,agrupados.get(String(fila.id))||[]),repetido:!insert.rows.length});
    } catch(e){if(client)await client.query('ROLLBACK').catch(()=>{}); errorHTTP(res,e);} finally{client?.release();}
  });
  router.put('/:id',async (req,res)=>{
    let client;
    try {
      client=await pool.connect();
      const id=String(req.params.id);
      if (!/^\d+$/.test(id)) {const e=new Error('Identificador inválido.');e.status=400;throw e;}
      const {datos,dias}=validar(req.body);
      await client.query('BEGIN');
      if (dias===null) {
        const {rows}=await client.query('SELECT 1 FROM public.viaticos_dias WHERE viatico_id=$1 LIMIT 1',[id]);
        if (rows.length) {const e=new Error('Actualiza el APK para editar este viático semanal.');e.status=409;throw e;}
      }
      const valores=CAMPOS.map(c=>datos[c]);
      const asignaciones=CAMPOS.map((c,i)=>`${c}=$${i+1}`).join(',');
      const {rows}=await client.query(`UPDATE public.viaticos SET ${asignaciones}, actualizado_en=now() WHERE id=$${valores.length+1} AND eliminado_en IS NULL RETURNING ${COLUMNAS}`,[...valores,id]);
      if (!rows.length){const e=new Error('Viático no encontrado.');e.status=404;throw e;}
      if (dias) await guardarDias(client,id,dias);
      const agrupados=await leerDias(client,[id]);
      await client.query('COMMIT');
      res.json({viatico:presentar(rows[0],agrupados.get(String(id))||[])});
    } catch(e){if(client)await client.query('ROLLBACK').catch(()=>{}); errorHTTP(res,e);} finally{client?.release();}
  });
  router.delete('/:id',async(req,res)=>{
    try {
      const id=String(req.params.id);
      if (!/^\d+$/.test(id))return res.status(400).json({error:'Identificador inválido.'});
      const {rows}=await pool.query('UPDATE public.viaticos SET eliminado_en=now(),actualizado_en=now() WHERE id=$1 AND eliminado_en IS NULL RETURNING id,folio',[id]);
      if (!rows.length)return res.status(404).json({error:'Viático no encontrado.'});
      res.json({eliminado:true,folio:rows[0].folio});
    } catch(e){errorHTTP(res,e);}
  });
  return router;
};
