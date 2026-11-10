import AsyncStorage from '@react-native-async-storage/async-storage';

// Este módulo NO envía datos a PostgreSQL. Las solicitudes se quedan en este teléfono.
const CLAVE = '@ordenesServicio/viaticos/v1';

export const listarViaticos = async () => {
  const valor = await AsyncStorage.getItem(CLAVE);
  if (!valor) return [];
  const datos = JSON.parse(valor);
  if (!Array.isArray(datos)) throw new Error('El historial de viáticos no tiene un formato válido.');
  return datos.sort((a, b) => (b.actualizadoEn || '').localeCompare(a.actualizadoEn || ''));
};

export const guardarViatico = async (nuevo) => {
  const actuales = await listarViaticos();
  const index = actuales.findIndex((item) => item.id === nuevo.id);
  const ordenes = [...actuales];
  if (index >= 0) ordenes[index] = nuevo;
  else ordenes.unshift(nuevo);
  await AsyncStorage.setItem(CLAVE, JSON.stringify(ordenes));
  return nuevo;
};

export const eliminarViatico = async (id) => {
  const actuales = await listarViaticos();
  await AsyncStorage.setItem(CLAVE, JSON.stringify(actuales.filter((item) => item.id !== id)));
};
