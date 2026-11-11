// Una sola URL para listar y crear órdenes. Para cambiar de servidor, edita aquí.
export const API_URL = 'https://ordenes-servicio-jdej.onrender.com/api/ordenes';

// El backend recibido en el proyecto solo tiene contrato conocido para estos campos.
// No intentamos enviar fotografías ni firmas en JSON: necesitan almacenamiento y API propios.
export const CAMPOS_BACKEND = [
  'motivo_servicio', 'nombre_unidad_medica', 'direccion',
  'ubicacion', 'contacto', 'no_contrato', 'tel_unidad', 'tel_responsable',
  'tiempo_garantia', 'equipo', 'marca', 'modelo', 'serie', 'inventario',
  'observaciones', 'observaciones_mtto_correctivo', 'tecnico_servicio',
  'responsable_unidad'
];

export const prepararOrdenServidor = (form) => {
  const payload = {};
  CAMPOS_BACKEND.forEach((campo) => {
    if (campo === 'marca') {
      // La API antigua tiene columnas separadas de marca/modelo.
      // Hasta actualizarla, conservamos el campo combinado en 'marca'.
      payload[campo] = form.marca_modelo?.trim() || form.marca || '';
    } else if (campo === 'modelo') {
      payload[campo] = form.marca_modelo?.trim() ? '' : (form.modelo || '');
    } else if (campo === 'observaciones_mtto_correctivo') {
      // Compatibilidad temporal: la API antigua no tiene 'recomendaciones'.
      payload[campo] = form.recomendaciones ?? form.observaciones_mtto_correctivo ?? '';
    } else {
      payload[campo] = form[campo] ?? '';
    }
  });
  // Compatibilidad con la API histórica, que aceptaba folio_orden = 0.
  // PostgreSQL DEBE tener instalado el trigger de folio automático del SQL incluido.
  // El trigger sustituye este valor por el folio oficial al insertar la orden.
  // IMPORTANTE: nunca usar 0 en un PDF ni como folio definitivo.
  payload.folio_orden = 0;
  return payload;
};

// === CONFIGURACIÓN MANUAL DE EMPRESAS ===
// 1. Coloca tus PNG en assets/logos/ (en la raíz del proyecto).
// 2. Cambia cada 'logo: null' por su require(...) cuando ya exista el PNG.
// 3. Escribe los datos REALES dentro de 'contacto'.
// Los logos y contactos quedan incluidos en el APK, para todos los teléfonos.
export const EMPRESAS = [
  {
    id: 'opciones',
    nombre: 'Opciones Médicas de Equipamiento S.A de C.V',
    logo: require('../../assets/logos/ome.png'), // Cambiar por: require('../../assets/logos/opciones.png')
    contacto: {
      direccion: 'Prolongacion de la Montaña 178, Planta Baja 6 Naucalpan de Juarez, Estado de México C.P. 53370', // DIRECCIÓN DE OPCIONES MÉDICAS
      telefono: '5555962310',  // TELÉFONO DE OPCIONES MÉDICAS
      email: 'omeservicio3@outlook.com'      // CORREO DE OPCIONES MÉDICAS
    }
  },
  {
    id: 'mexus',
    nombre: 'Mexus Hospitalaria S.A de C.V',
    logo: require('../../assets/logos/mexus.png'), // Cambiar por: require('../../assets/logos/mexus.png')
    contacto: {
      direccion: 'Fuente de Hermes #6 Col. Lomas de Tecamachalco, Huixquilucan Estado de México, C.P.52780', // DIRECCIÓN DE MEXUS
      telefono: '5559296551',  // TELÉFONO DE MEXUS
      email: 'mexusservicio@outlook.com'      // CORREO DE MEXUS
    }
  }
];

export const MOTIVOS = [
  'Apertura',
  'Instalación',
  'Capacitación',
  'Mtto. Preventivo',
  'Mtto. Correctivo'
];


// Respuestas posibles de servidores Express: {folio_orden}, {orden:{...}},
// {data:{...}}, o una lista con la orden creada. Jamás confundir ID con folio.
export const folioDeRespuesta = (respuesta) => {
  const cuerpo = respuesta?.data ?? respuesta;
  const anidados = [cuerpo, cuerpo?.orden, cuerpo?.data,
    cuerpo?.resultado, cuerpo?.result, cuerpo?.registro, cuerpo?.rows];
  const posibles = anidados.flatMap((dato) => Array.isArray(dato) ? dato : [dato]);
  for (const registro of posibles) {
    const numero = Number(registro?.folio_orden);
    if (Number.isSafeInteger(numero) && numero >= 1001) return numero;
  }
  return null;
};

export const idDeRespuesta = (respuesta) => {
  const cuerpo = respuesta?.data ?? respuesta;
  const anidados = [cuerpo, cuerpo?.orden, cuerpo?.data,
    cuerpo?.resultado, cuerpo?.result, cuerpo?.registro, cuerpo?.rows];
  const posibles = anidados.flatMap((dato) => Array.isArray(dato) ? dato : [dato]);
  for (const registro of posibles) {
    const id = Number(registro?.id);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }
  return null;
};

// La API ya admite GET para listar órdenes; úsalo únicamente cuando el POST
// haya devuelto ID pero no folio. No se adivinan folios por fecha ni por máximo.
export const buscarFolioPorId = async (axiosCliente, id) => {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const respuesta = await axiosCliente.get(API_URL, { timeout: 30000 });
  const cuerpo = respuesta?.data;
  const registros = Array.isArray(cuerpo) ? cuerpo
    : Array.isArray(cuerpo?.ordenes) ? cuerpo.ordenes
    : Array.isArray(cuerpo?.data) ? cuerpo.data : [];
  const orden = registros.find((item) => Number(item?.id) === id);
  const folio = Number(orden?.folio_orden);
  return Number.isSafeInteger(folio) && folio >= 1001 ? folio : null;
};
