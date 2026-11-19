import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Iniciamos sesión contra Render de viáticos. Ambos backends validan
// la misma sesión en PostgreSQL (misma DATABASE_URL).
export const API_AUTH_URL = 'https://ordenes-viaticos-test.onrender.com/api/auth';
const CLAVE_SESION = 'ordenes_viaticos_sesion_v1';
let interceptorInstalado = false;
let alCaducar = null;
// El perfil viene de /api/auth/login o /api/auth/me, no de los datos del formulario.
// Se conserva solo en memoria y se borra al cerrar o caducar la sesión.
let perfilSesion = null;
export const obtenerPerfilSesion = () => perfilSesion;

export const obtenerToken = () => SecureStore.getItemAsync(CLAVE_SESION);
export const establecerManejadorSesionCaducada = (handler) => { alCaducar = handler; };

export function esApiDeLaEmpresa(config) {
  const url = String(config?.url || '');
  const base = String(config?.baseURL || '');
  const completa = /^https?:\/\//i.test(url) ? url : `${base.replace(/\/$/,'')}/${url.replace(/^\//,'')}`;
  return /^https:\/\/(ordenes-servicio-jdej|ordenes-viaticos-test)\.onrender\.com\/api(?:\/|$)/i.test(completa);
}

export function configurarAxiosConSesion() {
  if (interceptorInstalado) return;
  interceptorInstalado = true;
  // Cubre axios.get/post usados directamente en las pantallas de órdenes.
  axios.interceptors.request.use(async (config) => {
    if (esApiDeLaEmpresa(config)) {
      const token = await obtenerToken();
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  });
  axios.interceptors.response.use(
    (respuesta) => respuesta,
    async (error) => {
      if (error?.response?.status === 401 && esApiDeLaEmpresa(error?.config)) {
        await caducarSesion();
      }
      return Promise.reject(error);
    }
  );
}

export async function caducarSesion() {
  perfilSesion = null;
  await SecureStore.deleteItemAsync(CLAVE_SESION).catch(() => {});
  if (typeof alCaducar === 'function') alCaducar();
}

export async function iniciarSesion(usuario, clave) {
  // No almacenar la contraseña: solo se usa para iniciar sesión.
  const respuesta = await axios.post(`${API_AUTH_URL}/login`, {
    usuario: usuario.trim().toLowerCase(), clave
  }, {timeout: 90000});
  const token = respuesta?.data?.token;
  const perfil = respuesta?.data?.usuario;
  if (!token || !perfil?.usuario) throw new Error('El servidor no devolvió una sesión válida.');
  await SecureStore.setItemAsync(CLAVE_SESION, token);
  perfilSesion = perfil;
  return perfil;
}

export async function restaurarSesion() {
  const token = await obtenerToken();
  if (!token) { perfilSesion = null; return null; }
  try {
    const respuesta = await axios.get(`${API_AUTH_URL}/me`, {
      headers: {Authorization: `Bearer ${token}`}, timeout: 90000
    });
    perfilSesion = respuesta?.data?.usuario || null;
    return perfilSesion;
  } catch (error) {
    if (error?.response?.status === 401) {
      await caducarSesion();
      return null;
    }
    throw new Error('No se pudo comprobar la sesión. Verifica internet o Render e inténtalo otra vez.');
  }
}

export async function cerrarSesion() {
  const token = await obtenerToken();
  let revocada = !token;
  if (token) {
    try {
      await axios.post(`${API_AUTH_URL}/logout`, {}, {
        headers: {Authorization: `Bearer ${token}`}, timeout: 15000
      });
      revocada = true;
    } catch (_) { revocada = false; }
  }
  await caducarSesion();
  return revocada;
}
