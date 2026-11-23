// Registro de un teléfono Android por cuenta técnica. No contiene claves privadas.
import {Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import axios from 'axios';
import {API_AUTH_URL, obtenerToken} from './authSesion';

const BASE = API_AUTH_URL.replace(/\/api\/auth\/?$/, '');
const ENDPOINT = `${BASE}/api/push-tecnicos`;
const CHANNEL_ID = 'reportes';
let tokenRegistrado = null;
let seq = 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registrarNotificacionesTecnico(cancelado = () => false) {
  if (Platform.OS !== 'android') return {ok: false, motivo: 'Solo Android'};
  const miSeq = ++seq;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Reportes asignados',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
  });
  const actual = await Notifications.getPermissionsAsync();
  const permiso = actual.granted
    ? actual
    : await Notifications.requestPermissionsAsync();
  if (!permiso.granted) return {ok: false, motivo: 'Permiso denegado'};
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
  if (!projectId) throw new Error('Falta extra.eas.projectId de Expo.');
  const pushToken = (await Notifications.getExpoPushTokenAsync({projectId})).data;
  if (!/^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(pushToken)) {
    throw new Error('Expo no devolvió un token válido.');
  }
  if (cancelado() || miSeq !== seq) return {ok: false, motivo: 'Sesión cambiada'};
  const sesion = await obtenerToken();
  if (!sesion || cancelado() || miSeq !== seq) return {ok: false, motivo: 'Sesión no disponible'};
  await axios.post(`${ENDPOINT}/registrar`, {expo_push_token: pushToken}, {
    headers: {Authorization: `Bearer ${sesion}`}, timeout: 20000,
  });
  if (cancelado() || miSeq !== seq) return {ok: false, motivo: 'Sesión cambiada'};
  tokenRegistrado = pushToken;
  return {ok: true};
}

export async function desregistrarNotificacionesTecnico() {
  ++seq;
  const pushToken = tokenRegistrado;
  tokenRegistrado = null;
  if (!pushToken) return true;
  const sesion = await obtenerToken();
  if (!sesion) return false;
  try {
    await axios.post(`${ENDPOINT}/retirar`, {expo_push_token: pushToken}, {
      headers: {Authorization: `Bearer ${sesion}`}, timeout: 12000,
    });
    return true;
  } catch (_error) {
    // Puede quedar una asociación previa si el cierre de sesión ocurre sin conexión.
    // El servidor nunca debe incluir datos clínicos ni información sensible en el push.
    return false;
  }
}
