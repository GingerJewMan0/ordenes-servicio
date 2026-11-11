import axios from 'axios';
import { API_URL } from './api';

// Se aloja en el MISMO backend que ya responde /api/ordenes.
export const API_VIATICOS_URL = API_URL.replace(/\/api\/ordenes\/?$/, '/api/viaticos');
if (API_VIATICOS_URL === API_URL) {
  console.warn('No se pudo derivar la URL de viáticos a partir de API_URL.');
}

const cliente = axios.create({ timeout: 30000 });
const unwrap = (respuesta) => {
  const fila = respuesta?.data?.viatico;
  if (!fila?.id || !/^V-\d+$/.test(String(fila.folio || ''))) {
    throw new Error('La API no confirmó el ID y el folio del viático. Consulta PostgreSQL antes de repetir el envío.');
  }
  return fila;
};

export const explicarErrorViaticos = (error) => {
  if (error?.response?.status === 404) {
    return 'La API /api/viaticos aún no existe en Render. Primero instala y despliega la ruta del backend incluida en el ZIP.';
  }
  if (error?.response?.data?.error) return String(error.response.data.error);
  if (error?.code === 'ECONNABORTED') {
    return 'La API tardó demasiado. El guardado podría haberse completado; revisa el historial en PostgreSQL antes de repetirlo.';
  }
  if (error?.message?.startsWith('La API devolvió')) return error.message;
  if (error?.response?.status >= 500 || !error?.response) {
    return 'No se confirmó el guardado en PostgreSQL. Comprueba la conexión y el historial antes de volver a enviar.';
  }
  return error?.message || 'No se pudo conectar con el servidor de viáticos.';
};

export const listarViaticosServidor = async () => {
  const respuesta = await cliente.get(API_VIATICOS_URL);
  const registros = respuesta?.data?.viaticos;
  if (!Array.isArray(registros)) throw new Error('La API devolvió un historial de viáticos inválido.');
  return registros;
};

export const crearViaticoServidor = async (solicitud, clientRequestId) => {
  const respuesta = await cliente.post(API_VIATICOS_URL, { ...solicitud, clientRequestId });
  return unwrap(respuesta);
};

export const actualizarViaticoServidor = async (id, solicitud) => {
  const respuesta = await cliente.put(`${API_VIATICOS_URL}/${encodeURIComponent(String(id))}`, solicitud);
  return unwrap(respuesta);
};

export const eliminarViaticoServidor = async (id) => {
  await cliente.delete(`${API_VIATICOS_URL}/${encodeURIComponent(String(id))}`);
};
