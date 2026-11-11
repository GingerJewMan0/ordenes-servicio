import axios from 'axios';

// Backend de viáticos independiente de la URL de órdenes de servicio.
export const API_VIATICOS_URL = 'https://ordenes-viaticos-test.onrender.com/api/viaticos';

// Render Free puede tardar más de 30 s en reactivarse.
// No se reintenta automáticamente un POST: podría haberse guardado.
const cliente = axios.create({ timeout: 90000 });

const unwrap = (respuesta) => {
  const fila = respuesta?.data?.viatico;
  if (!fila?.id || !/^V-\d+$/.test(String(fila.folio || ''))) {
    throw new Error('La API no confirmó el ID y folio. Consulta PostgreSQL antes de volver a enviar.');
  }
  return fila;
};

// La ausencia de una respuesta HTTP no confirma si el servidor guardó o no.
export const esGuardadoIncierto = (error) =>
  !error?.response || Number(error.response.status) >= 500;

export const explicarErrorViaticos = (error) => {
  const status = error?.response?.status;
  const mensaje = error?.response?.data?.error;
  if (typeof mensaje === 'string' && mensaje.trim()) {
    return `Servidor HTTP ${status}: ${mensaje}`;
  }
  if (status === 404) return 'El viático solicitado o la ruta de la API no existe (HTTP 404).';
  if (status === 409) return 'El servidor encontró un conflicto (HTTP 409). Comprueba el historial antes de repetir el envío.';
  if (status >= 400 && status < 500) return `El servidor rechazó los datos (HTTP ${status}).`;
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    return 'Se agotó el tiempo de espera (90 s). El servidor podría haber guardado los datos. Verifica el último envío antes de repetirlo.';
  }
  if (!error?.response) {
    return `Sin confirmación de red (${error?.code || 'sin código'}). Revisa el historial y usa «Comprobar último envío» antes de reintentar.`;
  }
  if (status >= 500) return `El servidor devolvió HTTP ${status}. Consulta los Logs de ordenes-viaticos-test y comprueba el historial.`;
  return error?.message || 'No se pudo confirmar la operación con PostgreSQL.';
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

// Consulta segura para comprobar un POST cuyo resultado no llegó al teléfono.
// El identificador de la solicitud se reutiliza si el usuario decide reintentar.
export const comprobarViaticoPorSolicitud = async (clientRequestId) => {
  const respuesta = await cliente.get(`${API_VIATICOS_URL}/solicitud/${encodeURIComponent(String(clientRequestId))}`);
  return unwrap(respuesta);
};

export const actualizarViaticoServidor = async (id, solicitud) => {
  const respuesta = await cliente.put(`${API_VIATICOS_URL}/${encodeURIComponent(String(id))}`, solicitud);
  return unwrap(respuesta);
};

export const eliminarViaticoServidor = async (id) => {
  await cliente.delete(`${API_VIATICOS_URL}/${encodeURIComponent(String(id))}`);
};
