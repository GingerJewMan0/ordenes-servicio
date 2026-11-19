// Comprobantes privados a traves del backend de viaticos en Render.
// NUNCA conectar Supabase directamente ni poner la secret key en Android.
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import { obtenerToken, caducarSesion } from './authSesion';
import { API_VIATICOS_URL } from './viaticosApi';
import { leerComprobantes } from './comprobantesViaticos';

const MAX = 8 * 1024 * 1024;
const ID_VALIDO = /^\d+$/;
const ID_COMPROBANTE = /^[0-9a-f-]{36}$/i;
const CARPETA_REMOTA = `${FileSystem.documentDirectory}comprobantes-viaticos-remotos/`;
const cliente = axios.create({ timeout: 90000 });
cliente.interceptors.request.use(async (cfg) => {
  const token = await obtenerToken();
  if (!token) throw new Error('Inicia sesion para consultar comprobantes.');
  cfg.headers = cfg.headers || {};
  cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
cliente.interceptors.response.use(x => x, async e => {
  if (e?.response?.status === 401) await caducarSesion();
  return Promise.reject(e);
});

function ruta(id) {
  if (!ID_VALIDO.test(String(id)) || Number(id) < 1) throw new Error('ID de viatico invalido.');
  return `${API_VIATICOS_URL}/${encodeURIComponent(String(id))}/comprobantes`;
}
const mensajeError = e => e?.response?.data?.error || e?.message || 'Error de red';

export async function listarComprobantesRemotos(id) {
  const {data} = await cliente.get(ruta(id));
  if (!Array.isArray(data?.comprobantes)) throw new Error('La API devolvio comprobantes invalidos.');
  return data;
}

function datosArchivo(item) {
  if (!item?.uri?.startsWith('file://')) throw new Error('Falta la foto original en este telefono.');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(item.id || ''))) throw new Error('Identificador local no valido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.fecha || ''))) throw new Error('Fecha de comprobante invalida.');
  const form = new FormData();
  form.append('clientId', String(item.id));
  form.append('fecha', item.fecha);
  form.append('concepto', item.concepto);
  form.append('archivo', {uri: item.uri, name:`comprobante-${item.id}.jpg`, type:'image/jpeg'});
  return form;
}
async function revisarArchivo(uri) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('La imagen ya no esta en este telefono.');
  if (!info.size || info.size > MAX) throw new Error('El comprobante supera 8 MB o esta vacio.');
  return info;
}
export async function subirComprobanteRemoto(id,item) {
  await revisarArchivo(item.uri);
  const {data} = await cliente.post(ruta(id), datosArchivo(item), {
    headers: {'Content-Type':'multipart/form-data'},
    timeout: 120000
  });
  if (!data?.comprobante?.id) throw new Error('La API no confirmo la subida. Consulta la lista antes de reintentar.');
  return data;
}
export async function finalizarComprobantesRemotos(id,clientIds) {
  const {data} = await cliente.post(`${ruta(id)}/finalizar`, {clientIds});
  if (!data?.finalizada) throw new Error('La API no confirmo el cierre de la captura.');
  return data;
}
export async function reemplazarComprobanteRemoto(viaticoId,comprobanteId, uri) {
  await revisarArchivo(uri);
  if (!ID_COMPROBANTE.test(comprobanteId)) throw new Error('ID de comprobante invalido.');
  const form = new FormData();
  form.append('archivo',{uri,name:'comprobante-reemplazo.jpg',type:'image/jpeg'});
  const {data}=await cliente.put(`${ruta(viaticoId)}/${encodeURIComponent(comprobanteId)}`,form,{
    headers:{'Content-Type':'multipart/form-data'},timeout:120000
  });
  if(!data?.comprobante?.id) throw new Error('Reemplazo sin confirmacion. Consulta la lista antes de reintentar.');
  return data;
}
export async function eliminarComprobanteRemoto(viaticoId,comprobanteId) {
  if (!ID_COMPROBANTE.test(comprobanteId)) throw new Error('ID de comprobante invalido.');
  const {data} = await cliente.delete(`${ruta(viaticoId)}/${encodeURIComponent(comprobanteId)}`);
  if(!data?.eliminado) throw new Error('El servidor no confirmo la eliminacion.');
  return data;
}

// La API verifica el SHA256 en el servidor antes de enviar la imagen.
export async function descargarComprobanteRemoto(viaticoId, item) {
  if (!ID_COMPROBANTE.test(String(item?.id || ''))) throw new Error('ID remoto invalido.');
  const ext = item.mimeType === 'image/png' ? 'png' : 'jpg';
  await FileSystem.makeDirectoryAsync(CARPETA_REMOTA,{intermediates:true});
  const destino = `${CARPETA_REMOTA}${viaticoId}_${item.id}.${ext}`;
  const previo = await FileSystem.getInfoAsync(destino);
  if (previo.exists && previo.size === Number(item.tamanoBytes)) return destino;
  const token = await obtenerToken();
  if (!token) throw new Error('Inicia sesion para descargar comprobantes.');
  const temporal = `${destino}.temporal`;
  await FileSystem.deleteAsync(temporal,{idempotent:true});
  try {
    const r=await FileSystem.downloadAsync(`${ruta(viaticoId)}/${item.id}`, temporal, {
      headers:{Authorization:`Bearer ${token}`}
    });
    if (r.status !== 200) {
      if (r.status === 401) await caducarSesion();
      throw new Error(`No se pudo descargar el comprobante (HTTP ${r.status}).`);
    }
    const info=await FileSystem.getInfoAsync(temporal);
    if (!info.exists || info.size !== Number(item.tamanoBytes)) throw new Error('La imagen descargada no coincide con el tamano original.');
    await FileSystem.deleteAsync(destino,{idempotent:true});
    await FileSystem.moveAsync({from:temporal,to:destino});
    return destino;
  } finally {
    await FileSystem.deleteAsync(temporal,{idempotent:true}).catch(()=>{});
  }
}

// Una foto nunca se borra de la copia local si la subida falla.
// Si una respuesta se pierde tras el POST, se consulta el servidor antes de cualquier reenvio.
export async function sincronizarComprobantesViatico(viaticoId, fotos, {cerrar=true}={}) {
  if (!Array.isArray(fotos)) throw new Error('Listado local de comprobantes invalido.');
  if (fotos.length > 100) throw new Error('El maximo para una captura es de 100 comprobantes.');
  const clientIds = fotos.map(f=>String(f.id));
  if (new Set(clientIds).size !== clientIds.length) throw new Error('Hay comprobantes con identificadores repetidos.');
  let remoto=await listarComprobantesRemotos(viaticoId);
  if (remoto.estadoCaptura === null) throw new Error('Este viatico es anterior al sistema de capturas: solo un administrador puede migrar sus comprobantes.');
  const pendientes=()=>fotos.filter(f => !remoto.comprobantes.some(x=>x.clientId===String(f.id)));
  if (remoto.estadoCaptura === 'cerrada') {
    if (pendientes().length) throw new Error('La captura esta cerrada y hay fotos locales sin subir. No se descartaron.');
    return {subidos:0,total:fotos.length,cerrada:true};
  }
  let subidos=0;
  for (const foto of pendientes()) {
    try { await subirComprobanteRemoto(viaticoId,foto); subidos++; }
    catch (e) {
      // Recuperacion de respuesta incierta: nunca duplicar ciegamente.
      if (e?.response?.status === 409) throw new Error('Conflicto de identificador de foto. No se reenviara ni reemplazara el archivo automaticamente.');
      remoto=await listarComprobantesRemotos(viaticoId).catch(()=>null);
      if (remoto?.comprobantes?.some(x=>x.clientId===String(foto.id) && x.fecha===foto.fecha && x.concepto===foto.concepto)) continue;
      throw new Error(`No se confirmo la foto ${foto.id}: ${mensajeError(e)}. Usa Reintentar sincronizacion, NO crees otro viatico.`);
    }
  }
  remoto=await listarComprobantesRemotos(viaticoId);
  if (pendientes().length) throw new Error('Hay fotos pendientes. Conserva los archivos y reintenta.');
  if (!cerrar) return {subidos,total:fotos.length,cerrada:false};
  const remotosIds=remoto.comprobantes.map(x=>x.clientId);
  if (remotosIds.length !== clientIds.length || remotosIds.some(x=>!clientIds.includes(x))) {
    throw new Error('El servidor contiene una lista distinta de comprobantes. No se cerro la captura.');
  }
  try { await finalizarComprobantesRemotos(viaticoId,clientIds); }
  catch(e) {
    const verificacion=await listarComprobantesRemotos(viaticoId).catch(()=>null);
    if(verificacion?.estadoCaptura !== 'cerrada') throw new Error(`Cierre sin confirmar: ${mensajeError(e)}. Comprueba antes de repetir.`);
  }
  return {subidos,total:fotos.length,cerrada:true};
}

// La lista remota es la fuente de verdad cuando una captura ya esta cerrada.
// Nunca fabricar un PDF parcial si el servidor remoto no responde.
export async function obtenerComprobantesParaVisualizar(viaticoId) {
  const guardados=await leerComprobantes(viaticoId);
  const remoto=await listarComprobantesRemotos(viaticoId);
  if(remoto.estadoCaptura === null && !remoto.comprobantes.length) {
    return {fotos:guardados,remotos:[],estadoCaptura:null};
  }
  const fotos=[];
  for (const item of remoto.comprobantes) {
    const local = guardados.find(x=>x.id===item.clientId);
    const encontrado = local?.uri ? await FileSystem.getInfoAsync(local.uri) : {exists:false};
    const copiaValida = encontrado.exists && encontrado.size === Number(item.tamanoBytes);
    fotos.push({...item, uri:copiaValida ? local.uri : await descargarComprobanteRemoto(viaticoId,item), remoto:true});
  }
  if (remoto.estadoCaptura === 'pendiente') {
    for(const local of guardados) {
      if (!remoto.comprobantes.some(x=>x.clientId===local.id)) fotos.push({...local,pendiente:true,remoto:false});
    }
  }
  return {fotos,remotos:remoto.comprobantes,estadoCaptura:remoto.estadoCaptura};
}
