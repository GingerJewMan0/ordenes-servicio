import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { EMPRESAS } from './api';

// Los datos ampliados se conservan solo en este dispositivo.
// NO equivale a respaldo o sincronización de fotos y firmas en el servidor.
const BASE = `${FileSystem.documentDirectory}ordenesServicio/`;
const KEY_PREFIX = '@ordenesServicio/v1/';

// Los datos de contacto se configuran una vez por empresa en cada dispositivo.
export const CONTACTO_VACIO = { direccion: '', telefono: '', email: '' };

export const cargarContactoEmpresa = async (empresaId) => {
  const texto = await AsyncStorage.getItem(`${KEY_PREFIX}contacto/${empresaId}`);
  const configurado = EMPRESAS.find((e) => e.id === empresaId)?.contacto;
  // La configuración incluida en el APK tiene prioridad sobre ajustes locales anteriores.
  if (configurado && Object.values(configurado).some((valor) => String(valor || '').trim())) {
    return { ...CONTACTO_VACIO, ...configurado };
  }
  if (!texto) return { ...CONTACTO_VACIO };
  const data = JSON.parse(texto);
  return {
    direccion: String(data.direccion || ''),
    telefono: String(data.telefono || ''),
    email: String(data.email || '')
  };
};

export const guardarContactoEmpresa = async (empresaId, datos) => {
  if (!EMPRESAS.some((e) => e.id === empresaId)) {
    throw new Error('Empresa no válida.');
  }
  const contacto = {
    direccion: String(datos.direccion || '').trim(),
    telefono: String(datos.telefono || '').trim(),
    email: String(datos.email || '').trim()
  };
  await AsyncStorage.setItem(`${KEY_PREFIX}contacto/${empresaId}`, JSON.stringify(contacto));
  return contacto;
};

const asegurarCarpeta = async (segmento) => {
  const carpeta = `${BASE}${segmento}/`;
  await FileSystem.makeDirectoryAsync(carpeta, { intermediates: true });
  return carpeta;
};

const crearNombre = (prefijo, extension) =>
  `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extension}`;

const guardarImagen = async (uri, prefijo, segmento, mimeType) => {
  const carpeta = await asegurarCarpeta(segmento);
  const esPng = mimeType === 'image/png' || /\.png(?:$|\?)/i.test(uri);
  const extension = esPng ? 'png' : 'jpg';
  const destino = carpeta + crearNombre(prefijo, extension);
  await FileSystem.copyAsync({ from: uri, to: destino });
  return destino;
};

export const guardarFoto = async (asset, etapa) => {
  if (!asset?.uri) throw new Error('No se recibió una fotografía válida.');
  return guardarImagen(asset.uri, etapa, 'fotos', asset.mimeType);
};

export const guardarFirma = async (dataUrl, tipo) => {
  const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl || '');
  if (!match) throw new Error('La firma no tiene un formato PNG válido.');
  const carpeta = await asegurarCarpeta('firmas');
  const destino = carpeta + crearNombre(tipo, 'png');
  await FileSystem.writeAsStringAsync(destino, match[1], {
    encoding: FileSystem.EncodingType.Base64
  });
  return destino;
};

export const cargarLogo = async (empresaId) => {
  const fijo = EMPRESAS.find((e) => e.id === empresaId)?.logo;
  if (fijo) return fijo;
  const uri = await AsyncStorage.getItem(`${KEY_PREFIX}logo/${empresaId}`);
  if (!uri) return null;
  const existe = await FileSystem.getInfoAsync(uri);
  return existe.exists ? uri : null;
};

export const configurarLogo = async (empresaId, asset) => {
  const nuevoLogo = await guardarImagen(asset.uri, `logo-${empresaId}`, 'logos', asset.mimeType);
  await AsyncStorage.setItem(`${KEY_PREFIX}logo/${empresaId}`, nuevoLogo);
  return nuevoLogo;
};

const claveOrden = (empresaId, folio) => `${KEY_PREFIX}orden/${empresaId}/${String(folio)}`;

export const guardarOrdenLocal = async (orden) => {
  if (!orden.empresaId || !orden.form?.folio_orden) {
    throw new Error('Falta empresa o folio para conservar las evidencias.');
  }
  await AsyncStorage.setItem(
    claveOrden(orden.empresaId, orden.form.folio_orden),
    JSON.stringify({ ...orden, fechaRegistro: new Date().toISOString() })
  );
};

export const leerOrdenLocal = async (folio, empresaId) => {
  if (empresaId) {
    const valor = await AsyncStorage.getItem(claveOrden(empresaId, folio));
    return valor ? JSON.parse(valor) : null;
  }
  // La API antigua no informa la empresa; buscamos evidencia local por folio.
  const resultados = await Promise.all(EMPRESAS.map((e) =>
    AsyncStorage.getItem(claveOrden(e.id, folio))
  ));
  const disponibles = resultados.filter(Boolean);
  // Si coinciden los folios de ambas empresas no adivinamos cuál es la correcta.
  if (disponibles.length !== 1) return null;
  return JSON.parse(disponibles[0]);
};

export const nombreEmpresa = (empresaId) =>
  EMPRESAS.find((e) => e.id === empresaId)?.nombre || 'Empresa sin especificar';
