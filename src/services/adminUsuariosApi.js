import axios from 'axios';
import { obtenerToken } from './authSesion';

// El servidor de viáticos comparte usuarios y sesiones con el de órdenes.
const URL = 'https://ordenes-viaticos-test.onrender.com/api/admin/usuarios';

async function config() {
  const token = await obtenerToken();
  if (!token) throw new Error('No hay una sesión activa. Vuelve a iniciar sesión.');
  return {headers: {Authorization: `Bearer ${token}`}, timeout: 90000};
}

export const listarUsuarios = async () => {
  const r = await axios.get(URL, await config());
  return Array.isArray(r.data?.usuarios) ? r.data.usuarios : [];
};

export const crearTecnico = async (usuario, clave) => {
  const r = await axios.post(URL, {usuario, clave, rol: 'tecnico'}, await config());
  return r.data?.usuario;
};

export const renombrarTecnico = async (id, usuario) => {
  const r = await axios.patch(`${URL}/${encodeURIComponent(id)}`, {usuario}, await config());
  return r.data?.usuario;
};

// Eliminar cuenta de técnico. Requiere autorización y validación del rol en el backend.
// Este endpoint debe eliminar o retirar el acceso SIN borrar historial ni auditoría.
export const eliminarTecnico = async (id) => {
  const r = await axios.delete(`${URL}/${encodeURIComponent(id)}`, await config());
  return r.data;
};

export const cambiarClaveTecnico = async (id, clave) => {
  const r = await axios.put(`${URL}/${encodeURIComponent(id)}/clave`, {clave}, await config());
  return r.data;
};

export function mensajeErrorUsuarios(error) {
  const mensajeServidor = error?.response?.data?.error;
  if (typeof mensajeServidor === 'string' && mensajeServidor) return mensajeServidor;
  if (error?.response?.status === 403) return 'Tu cuenta no tiene permiso de administración.';
  if (error?.response?.status === 401) return 'La sesión caducó. Inicia sesión nuevamente.';
  if (error?.response?.status === 404) return 'La cuenta ya no existe en el servidor.';
  if (error?.response?.status === 409) return 'Ese nombre de usuario ya existe.';
  return error?.message || 'No se pudo conectar con el servidor.';
}
