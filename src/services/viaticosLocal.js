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


// Serie independiente de los folios de órdenes. Solo es única en este teléfono.
const CLAVE_CONTADOR = '@ordenesServicio/viaticos/ultimoFolio/v1';
let colaReservas = Promise.resolve();

export const reservarFolioViatico = () => {
  const tarea = colaReservas.then(async () => {
    // Una operación de lectura / incremento / escritura a la vez en este JS runtime.
    // Incluye folios previos V-0001... en el historial para evitar reutilizarlos.
    const [guardado, historial] = await Promise.all([
      AsyncStorage.getItem(CLAVE_CONTADOR), listarViaticos()
    ]);
    const historialMaximo = historial.reduce((maximo, item) => {
      const coincidencia = /^V-(\d+)$/i.exec(String(item.folio || '').trim());
      return coincidencia ? Math.max(maximo, Number(coincidencia[1])) : maximo;
    }, 0);
    const ultimo = Number(guardado);
    const base = Math.max(Number.isSafeInteger(ultimo) && ultimo > 0 ? ultimo : 0, historialMaximo);
    if (!Number.isSafeInteger(base) || base >= Number.MAX_SAFE_INTEGER - 1) {
      throw new Error('No se pudo generar un nuevo folio de viáticos.');
    }
    const siguiente = base + 1;
    await AsyncStorage.setItem(CLAVE_CONTADOR, String(siguiente));
    return `V-${String(siguiente).padStart(4, '0')}`;
  });
  colaReservas = tarea.then(() => undefined, () => undefined);
  return tarea;
};
