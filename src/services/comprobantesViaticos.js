// Conserva comprobantes en el almacenamiento PRIVADO del dispositivo.
// Una copia puede sincronizarse via el backend a Supabase; los originales no se borran.
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIJO = '@ordenesServicio/comprobantesViaticos/v1/';
const carpeta = `${FileSystem.documentDirectory}comprobantes-viaticos/`;
const clave = (id) => `${PREFIJO}${String(id || 'borrador')}`;

export async function leerComprobantes(id) {
  const raw = await AsyncStorage.getItem(clave(id));
  if (!raw) return [];
  try { const datos = JSON.parse(raw); return Array.isArray(datos) ? datos : []; }
  catch { return []; }
}
export async function guardarComprobantes(id, comprobantes) {
  await AsyncStorage.setItem(clave(id), JSON.stringify(comprobantes));
}
export async function borrarComprobantes(id) {
  await AsyncStorage.removeItem(clave(id));
}
export async function pasarBorradorAViatico(id, comprobantes) {
  await guardarComprobantes(id, comprobantes);
  await borrarComprobantes('borrador');
}
export async function copiarComprobante(uri, fecha, concepto) {
  if (!uri) throw new Error('No se recibió una foto válida.');
  await FileSystem.makeDirectoryAsync(carpeta, { intermediates: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const destino = `${carpeta}${id}.jpg`;
  // Guardar una copia JPEG real y persistente: el backend privado acepta solo JPEG/PNG.
  // No altera ni borra el archivo original de la camara/galeria.
  const jpeg = await manipulateAsync(uri, [], {format: SaveFormat.JPEG, compress: 0.90});
  await FileSystem.copyAsync({ from: jpeg.uri, to: destino });
  const info = await FileSystem.getInfoAsync(destino);
  if (!info.exists || !info.size || info.size > 8 * 1024 * 1024) {
    await FileSystem.deleteAsync(destino, {idempotent:true});
    throw new Error('La fotografia excede 8 MB o no se pudo guardar.');
  }
  return { id, fecha, concepto, uri: destino };
}
export async function quitarArchivoComprobante(item) {
  if (item?.uri?.startsWith(carpeta)) {
    await FileSystem.deleteAsync(item.uri, { idempotent: true });
  }
}
