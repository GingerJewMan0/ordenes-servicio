import axios from 'axios';
import {API_AUTH_URL} from './authSesion';

// El backend de reportes debe desplegarse en el MISMO origen de login.
// El token se incorpora automáticamente mediante configurarAxiosConSesion().
export const REPORTES_API_BASE_URL = API_AUTH_URL.replace(/\/api\/auth\/?$/, '');
const ADMIN_PATH = '/api/reportes-hospitalarios/admin';

function mensajeError(error) {
  return error?.response?.data?.error ||
    (error?.response?.status === 401 ? 'La sesión caducó. Inicia sesión nuevamente.' :
      error?.response?.status === 403 ? 'Solo administradores pueden consultar reportes.' :
      error?.message || 'No se pudo comunicar con el servidor.');
}

async function solicitar(method, sufijo = '', data) {
  try {
    const response = await axios({
      method,
      url: `${REPORTES_API_BASE_URL}${ADMIN_PATH}${sufijo}`,
      timeout: 25000,
      headers: {Accept: 'application/json'},
      ...(data === undefined ? {} : {data})
    });
    return response.data;
  } catch (error) {
    throw new Error(mensajeError(error));
  }
}

// Reutiliza axios configurado por configurarAxiosConSesion() del proyecto.
// No intenta leer el token desde AsyncStorage por cuenta propia.
export function crearApiReportesHospitalarios() {
  return {
    listar: (estado = '') => solicitar('get', estado ? `?estado=${encodeURIComponent(estado)}` : ''),
    resumen: () => solicitar('get', '/resumen'),
    detalle: id => solicitar('get', `/${encodeURIComponent(String(id))}`),
    actualizar: (id, estado, nota) => solicitar('patch', `/${encodeURIComponent(String(id))}`, {estado, nota})
  };
}
