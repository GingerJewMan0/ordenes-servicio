import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Iniciamos sesión contra Render de viáticos. Ambos backends validan
// la misma sesión en PostgreSQL (misma DATABASE_URL).
export const API_AUTH_URL = 'https://ordenes-viaticos-test.onrender.com/api/auth';
const CLAVE_SESION = 'ordenes_viaticos_sesion_v1';
const CLAVE_CIERRE_PENDIENTE = 'ordenes_viaticos_cierre_pendiente_v1';
// Cola protegida de cierres pendientes.
let operacionPendientes = Promise.resolve();

function serializarPendientes(tarea) {
  const resultado = operacionPendientes.then(tarea, tarea);
  operacionPendientes = resultado.catch(() => {});
  return resultado;
}

async function leerCierresPendientes() {
  const guardado = await SecureStore.getItemAsync(
    CLAVE_CIERRE_PENDIENTE
  );

  if (!guardado) return [];

  try {
    const lista = JSON.parse(guardado);

    if (
      Array.isArray(lista) &&
      lista.every(token => typeof token === 'string')
    ) {
      return lista;
    }
  } catch (_) {
    // Compatibilidad con el formato anterior de un solo token.
    if (/^[A-Za-z0-9_-]{32,256}$/.test(guardado)) {
      return [guardado];
    }
  }

  throw new Error('Formato de cierres pendientes no válido.');
}

async function agregarCierrePendiente(token) {
  return serializarPendientes(async () => {
    const lista = await leerCierresPendientes();

    if (lista.includes(token)) return;

    if (lista.length >= 20) {
      throw new Error('Se alcanzó el límite de cierres pendientes.');
    }

    lista.push(token);

    await SecureStore.setItemAsync(
      CLAVE_CIERRE_PENDIENTE,
      JSON.stringify(lista)
    );
  });
}

async function quitarCierrePendiente(token) {
  return serializarPendientes(async () => {
    const lista = await leerCierresPendientes();
    const restantes = lista.filter(item => item !== token);

    if (restantes.length === lista.length) return;

    if (restantes.length === 0) {
      await SecureStore.deleteItemAsync(CLAVE_CIERRE_PENDIENTE);
    } else {
      await SecureStore.setItemAsync(
        CLAVE_CIERRE_PENDIENTE,
        JSON.stringify(restantes)
      );
    }
  });
}
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
  let pendienteGuardado = false;

  if (token) {
    // Conservar el token para revocar la sesión si no hay internet.
    try {
  await agregarCierrePendiente(token);
  pendienteGuardado = true;
} catch (error) {
  console.warn(
    '[Auth] No se pudo guardar el cierre pendiente:',
    error?.message
  );
}

    try {
      await axios.post(
        `${API_AUTH_URL}/logout`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 15000
        }
      );

      revocada = true;

      await quitarCierrePendiente(token).catch(error => {
  console.warn(
    '[Auth] No se pudo quitar el cierre pendiente:',
    error?.message
  );
});

    } catch (error) {
      // Sin conexión: conservar el cierre pendiente.
      revocada = false;
      console.warn('[Auth] Cierre pendiente de sincronización.');
      if (!pendienteGuardado) {
  throw new Error(
    'No se pudo contactar al servidor ni guardar el cierre pendiente. Vuelve a intentarlo.'
  );
}
    }
  }

  // Cerrar la sesión local incluso sin conexión.
  await caducarSesion();

  return revocada;
}
export async function sincronizarCierrePendiente() {
  let pendientes;

  try {
    pendientes = await serializarPendientes(
      () => leerCierresPendientes()
    );
  } catch (error) {
    console.warn(
      '[Auth] No se pudieron leer los cierres pendientes:',
      error?.message
    );
    return false;
  }

  if (pendientes.length === 0) return true;

  const cliente = axios.create();
  let todoCorrecto = true;

  for (const token of pendientes) {
    try {
      await cliente.post(
        `${API_AUTH_URL}/logout`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 15000,
          validateStatus: status =>
            (status >= 200 && status < 300) || status === 401
        }
      );

      // Eliminar únicamente la sesión ya revocada o caducada.
      await quitarCierrePendiente(token);

      console.log('[Auth] Cierre pendiente sincronizado.');
    } catch (error) {
      todoCorrecto = false;

      // Conservar el token para otro intento.
      console.warn(
        '[Auth] No se pudo sincronizar un cierre pendiente:',
        error?.message || 'Sin conexión'
      );
    }
  }

  return todoCorrecto;
}
