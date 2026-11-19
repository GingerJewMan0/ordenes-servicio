import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import { API_URL } from './api';

// Usa el interceptor de sesión que ya tiene el proyecto para axios.
// La clave privada de Supabase nunca debe llegar al dispositivo.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FOTOS = 20;
const URL_EVIDENCIAS = (id) => {
  const numero = Number(id);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error('Falta el ID interno de PostgreSQL. No se repetirá el POST de la orden.');
  }
  return `${API_URL}/${numero}/evidencias`;
};

export async function listarEvidenciasRemotas(ordenId) {
  const respuesta = await axios.get(URL_EVIDENCIAS(ordenId), { timeout: 60000 });
  const lista = respuesta?.data?.evidencias;
  if (!Array.isArray(lista)) throw new Error('El servidor devolvió una lista de evidencias inválida.');
  return lista;
}

export function prepararArchivosEvidencia(ordenLocal) {
  const antes = ordenLocal?.fotosAntes || [];
  const despues = ordenLocal?.fotosDespues || [];
  const firmaT = ordenLocal?.firmaTecnico;
  const firmaR = ordenLocal?.firmaResponsable;
  if (antes.length < 3 || despues.length < 3 || !firmaT || !firmaR) {
    throw new Error('La copia local debe tener al menos 3 fotos antes, 3 después y las 2 firmas.');
  }
  if (antes.length > MAX_FOTOS || despues.length > MAX_FOTOS) {
    throw new Error('El servidor permite como máximo 20 fotografías por etapa.');
  }
  const construir = (fotos, tipo) => fotos.map((uri, indice) => ({
    uri, tipo, posicion: indice + 1
  }));
  return [
    ...construir(antes, 'foto_antes'),
    ...construir(despues, 'foto_despues'),
    { uri: firmaT, tipo: 'firma_tecnico', posicion: 1 },
    { uri: firmaR, tipo: 'firma_responsable', posicion: 1 }
  ];
}

function propiedadesArchivo(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) {
    throw new Error('La evidencia no tiene una ruta local válida.');
  }
  const esPng = /\.png(?:$|\?)/i.test(uri);
  return {
    uri,
    name: `evidencia-${Date.now()}.${esPng ? 'png' : 'jpg'}`,
    type: esPng ? 'image/png' : 'image/jpeg'
  };
}

async function comprobarArchivoLocal(uri) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) throw new Error('No se encontró una fotografía o firma en el teléfono.');
  if (Number(info.size) > MAX_BYTES) throw new Error('Una imagen supera los 8 MB permitidos.');
  if (Number(info.size) < 1) throw new Error('Una imagen local está vacía.');
  return Number(info.size);
}

function clave(e) { return `${e.tipo}:${Number(e.posicion)}`; }

// Una petición pudo haberse almacenado aun cuando el teléfono perdió la respuesta.
// Antes de cada envío volvemos a listar las posiciones existentes, nunca hacemos
// POST de la orden por segunda vez ni tratamos de sustituir una evidencia.
export async function sincronizarCapturaInicial(ordenId, ordenLocal, actualizarProgreso = () => {}) {
  const base = URL_EVIDENCIAS(ordenId);
  const archivos = prepararArchivosEvidencia(ordenLocal);
  // Validar todo ANTES del primer POST: evita una captura parcialmente subida
  // por un archivo local que faltaba o era demasiado grande.
  const tamanos = await Promise.all(archivos.map((item) => comprobarArchivoLocal(item.uri)));
  let remotas = await listarEvidenciasRemotas(ordenId);
  const posiciones = new Map(remotas.map((e) => [clave(e), e]));
  let hechos = 0;

  for (let indice = 0; indice < archivos.length; indice += 1) {
    const item = archivos[indice];
    const tamano = tamanos[indice];
    let existente = posiciones.get(clave(item));
    if (existente) {
      if (Number(existente.tamano_bytes) !== tamano) {
        throw new Error(`La posición ${item.tipo} #${item.posicion} ya existe en el servidor con otro tamaño. Requiere revisión; no se sobrescribirá.`);
      }
      // El backend comprueba SHA-256 del objeto almacenado al finalizar;
      // el tamaño coincidente no prueba que los dos originales sean idénticos.
    } else {
      const formulario = new FormData();
      formulario.append('tipo', item.tipo);
      formulario.append('posicion', String(item.posicion));
      formulario.append('archivo', propiedadesArchivo(item.uri));
      try {
        await axios.post(base, formulario, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000
        });
      } catch (error) {
        // No reintentar a ciegas: una respuesta perdida puede haber sido 201.
        const estado = error?.response?.status;
        if (estado !== 409 && estado !== undefined && estado !== null) throw error;
        // Para 409 o timeout verificamos qué quedó realmente registrado.
      }
      remotas = await listarEvidenciasRemotas(ordenId);
      posiciones.clear();
      remotas.forEach((e) => posiciones.set(clave(e), e));
      existente = posiciones.get(clave(item));
      if (!existente) {
        throw new Error(`No se pudo confirmar en el servidor la evidencia ${item.tipo} #${item.posicion}.`);
      }
      if (Number(existente.tamano_bytes) !== tamano) {
        throw new Error(`La evidencia ${item.tipo} #${item.posicion} no coincide en tamaño. No se cerrará la captura.`);
      }
    }
    hechos += 1;
    actualizarProgreso(hechos, archivos.length);
  }

  // Una nueva lectura confirma que todas las posiciones están presentes.
  remotas = await listarEvidenciasRemotas(ordenId);
  const confirmadas = new Map(remotas.map((e) => [clave(e), e]));
  if (archivos.some((item) => !confirmadas.has(clave(item)))) {
    throw new Error('Faltan evidencias remotas: la captura seguirá pendiente.');
  }
  try {
    await axios.post(`${base}/finalizar`, {}, { timeout: 150000 });
  } catch (error) {
    // Después de una pérdida de respuesta, el servidor puede haberse cerrado.
    const estado = error?.response?.status;
    const mensaje = String(error?.response?.data?.error || '');
    if (estado !== 409 || !/ya fue cerrada/i.test(mensaje)) throw error;
  }
  return { total: remotas.length, finalizada: true };
}

// Conversión de ArrayBuffer a Base64, sin instalar dependencias criptográficas
// ni exponer los URLs o credenciales privadas de Supabase.
function arrayBufferABase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const partes = [];
  let bloque = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    bloque += alfabeto[a >> 2] + alfabeto[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alfabeto[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alfabeto[c & 63] : '=');
    if (bloque.length > 8192) { partes.push(bloque); bloque = ''; }
  }
  if (bloque) partes.push(bloque);
  return partes.join('');
}

// Descarga por Axios autenticado. El backend, no el teléfono, verifica la
// integridad SHA-256 antes de enviar los bytes. El caché es privado de la app.
export async function descargarEvidenciaPrivada(ordenId, evidencia) {
  const id = String(evidencia?.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador de evidencia inválido.');
  const extension = evidencia.mime_type === 'image/png' ? 'png' : 'jpg';
  const carpeta = `${FileSystem.cacheDirectory}evidenciasPrivadas/${Number(ordenId)}/`;
  await FileSystem.makeDirectoryAsync(carpeta, { intermediates: true });
  const destino = `${carpeta}${id}.${extension}`;
  const actual = await FileSystem.getInfoAsync(destino);
  if (actual.exists && Number(actual.size) === Number(evidencia.tamano_bytes)) return destino;

  const respuesta = await axios.get(`${URL_EVIDENCIAS(ordenId)}/${id}`, {
    responseType: 'arraybuffer', timeout: 120000
  });
  const datos = respuesta.data;
  const buffer = datos instanceof ArrayBuffer ? datos
    : (ArrayBuffer.isView(datos)
      ? datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength)
      : null);
  if (!buffer) throw new Error('Android no devolvió los bytes de la evidencia.');
  if (buffer.byteLength !== Number(evidencia.tamano_bytes)) {
    throw new Error('La descarga no coincide en tamaño con PostgreSQL.');
  }
  const temporal = `${destino}.temp`;
  try {
    await FileSystem.writeAsStringAsync(temporal, arrayBufferABase64(buffer), {
      encoding: FileSystem.EncodingType.Base64
    });
    const verificacion = await FileSystem.getInfoAsync(temporal);
    if (!verificacion.exists || Number(verificacion.size) !== buffer.byteLength) {
      throw new Error('El archivo descargado quedó incompleto.');
    }
    await FileSystem.deleteAsync(destino, { idempotent: true });
    await FileSystem.moveAsync({ from: temporal, to: destino });
    return destino;
  } finally {
    await FileSystem.deleteAsync(temporal, { idempotent: true }).catch(() => {});
  }
}

export async function cargarGaleriaRemota(ordenId) {
  const lista = await listarEvidenciasRemotas(ordenId);
  const galeria = { fotosAntes: [], fotosDespues: [], firmaTecnico: null, firmaResponsable: null };
  const errores = [];
  for (const evidencia of lista) {
    try {
      const uri = await descargarEvidenciaPrivada(ordenId, evidencia);
      if (evidencia.tipo === 'foto_antes') galeria.fotosAntes.push({ posicion: evidencia.posicion, uri });
      if (evidencia.tipo === 'foto_despues') galeria.fotosDespues.push({ posicion: evidencia.posicion, uri });
      if (evidencia.tipo === 'firma_tecnico') galeria.firmaTecnico = uri;
      if (evidencia.tipo === 'firma_responsable') galeria.firmaResponsable = uri;
    } catch (error) {
      errores.push(`${evidencia.tipo} #${evidencia.posicion}: ${error?.message || 'Error'}`);
    }
  }
  const ordenar = (a, b) => Number(a.posicion) - Number(b.posicion);
  galeria.fotosAntes.sort(ordenar);
  galeria.fotosDespues.sort(ordenar);
  return {
    galeria: {
      fotosAntes: galeria.fotosAntes.map((e) => e.uri),
      fotosDespues: galeria.fotosDespues.map((e) => e.uri),
      firmaTecnico: galeria.firmaTecnico,
      firmaResponsable: galeria.firmaResponsable
    },
    totalServidor: lista.length,
    errores
  };
}
