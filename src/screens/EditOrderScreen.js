import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { editarOrdenEnServidor } from '../services/api';
import { guardarOrdenLocal, leerOrdenLocal } from '../services/ordenesLocales';

const CAMPOS = [
  ['Unidad médica', 'nombre_unidad_medica'],
  ['Dirección', 'direccion'],
  ['Ubicación / Área', 'ubicacion'],
  ['Contacto', 'contacto'],
  ['No. de contrato / Programa', 'no_contrato'],
  ['Teléfono unidad', 'tel_unidad'],
  ['Teléfono responsable', 'tel_responsable'],
  ['Tiempo de garantía', 'tiempo_garantia'],
  ['Motivo de visita', 'motivo_servicio'],
  ['Equipo', 'equipo'],
  ['Marca y Modelo', 'marca_modelo'],
  ['N/S', 'serie'],
  ['Inventario', 'inventario'],
  ['Observaciones', 'observaciones'],
  ['Recomendaciones', 'recomendaciones'],
  ['Técnico de servicio', 'tecnico_servicio'],
  ['Responsable de la unidad', 'responsable_unidad']
];
const CAMPOS_TECNICOS = [
  ['Reporte', 'reporte'],
  ['Material y refacciones', 'material_refacciones'],
  ['Pruebas eléctricas', 'pruebas_electricas'],
  ['Simulador', 'simulador']
];
const REMOTOS_DIRECTOS = CAMPOS.map(([, campo]) => campo)
  .filter(campo => campo !== 'marca_modelo' && campo !== 'recomendaciones');
const comoTexto = (valor) => valor == null ? '' : String(valor);
const combinado = (orden) => [orden?.marca, orden?.modelo].filter(Boolean).join(' / ');

function crearFormulario(orden, local) {
  const base = local?.form || {};
  const datos = { ...base };
  for (const campo of REMOTOS_DIRECTOS) {
    datos[campo] = comoTexto(orden?.[campo] ?? base?.[campo]);
  }
  datos.marca_modelo = comoTexto(combinado(orden) || base.marca_modelo);
  datos.recomendaciones = comoTexto(orden?.observaciones_mtto_correctivo ?? base.recomendaciones);
  // PostgreSQL es la fuente de verdad; para órdenes antiguas sin estos valores
  // se presentan los datos locales previamente capturados para sincronizarlos.
  for (const [, campo] of CAMPOS_TECNICOS) {
    datos[campo] = comoTexto(orden?.[campo] ?? base?.[campo]);
  }
  return datos;
}

export default function EditOrderScreen({ route, navigation }) {
  const original = route.params?.orden || {};
  const id = Number(original.id);
  const idValido = Number.isSafeInteger(id) && id > 0;
  const [local, setLocal] = useState(route.params?.evidenciaLocal || null);
  const [cargando, setCargando] = useState(!route.params?.evidenciaLocal);
  const [form, setForm] = useState(() => crearFormulario(original, route.params?.evidenciaLocal));
  const [guardando, setGuardando] = useState(false);
  const titulo = `Editar orden #${original.folio_orden ?? '—'}`;

  useEffect(() => {
    navigation.setOptions({ title: titulo });
  }, [navigation, titulo]);

  useEffect(() => {
    if (route.params?.evidenciaLocal) return;
    let activo = true;
    leerOrdenLocal(original.folio_orden, original.empresaId || null)
      .then((valor) => {
        if (!activo) return;
        setLocal(valor || null);
        setForm(crearFormulario(original, valor));
      })
      .catch((e) => console.warn('No se pudieron cargar datos locales:', e?.message))
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [original.id, original.folio_orden, original.empresaId]);

  // Si la orden fue creada con una versión anterior, los cuatro campos
  // podrían existir solo en el teléfono. Permitir sincronizarlos sin perderlos.
  const pendientesPorSincronizar = CAMPOS_TECNICOS.some(([, campo]) =>
    original[campo] == null && comoTexto(local?.form?.[campo]).trim() !== '');
  const tieneCambios = useMemo(() => {
    const antes = crearFormulario(original, local);
    return pendientesPorSincronizar || [...CAMPOS, ...CAMPOS_TECNICOS]
      .some(([, campo]) => comoTexto(form[campo]) !== comoTexto(antes[campo]));
  }, [form, original, local, pendientesPorSincronizar]);

  const guardar = async () => {
    if (guardando || cargando || !idValido) return;
    if (!form.nombre_unidad_medica?.trim() || !form.equipo?.trim()) {
      Alert.alert('Faltan datos', 'La unidad médica y el equipo son obligatorios.');
      return;
    }
    if (!tieneCambios) {
      Alert.alert('Sin modificaciones', 'No hay cambios para guardar.');
      return;
    }
    const antes = crearFormulario(original, local);
    const cambios = {};
    for (const campo of REMOTOS_DIRECTOS) {
      if (comoTexto(form[campo]) !== comoTexto(antes[campo])) cambios[campo] = comoTexto(form[campo]);
    }
    if (comoTexto(form.marca_modelo) !== comoTexto(antes.marca_modelo)) {
      // Compatibilidad con columnas existentes: almacena el campo combinado en marca.
      cambios.marca = comoTexto(form.marca_modelo);
      cambios.modelo = '';
    }
    if (comoTexto(form.recomendaciones) !== comoTexto(antes.recomendaciones)) {
      cambios.observaciones_mtto_correctivo = comoTexto(form.recomendaciones);
    }
    for (const [, campo] of CAMPOS_TECNICOS) {
      if (comoTexto(form[campo]) !== comoTexto(antes[campo]) ||
          (original[campo] == null && comoTexto(local?.form?.[campo]).trim() !== '')) {
        cambios[campo] = comoTexto(form[campo]);
      }
    }
    setGuardando(true);
    let registro = original;
    let remotoGuardado = false;
    try {
      if (Object.keys(cambios).length) {
        const respuesta = await editarOrdenEnServidor(id, cambios);
        const confirmado = respuesta?.data;
        // La API debe devolver la fila actualizada; no anunciar éxito si
        // el servidor ignoró algún dato del informe técnico.
        if (!confirmado || Number(confirmado.id) !== id) {
          throw new Error('El servidor no confirmó la actualización de esta orden.');
        }
        for (const [, campo] of CAMPOS_TECNICOS) {
          if (Object.prototype.hasOwnProperty.call(cambios, campo) &&
              comoTexto(confirmado[campo]) !== comoTexto(cambios[campo])) {
            throw new Error('El servidor no confirmó el campo: ' + campo + '. Comprueba PostgreSQL antes de repetir.');
          }
        }
        registro = confirmado;
        remotoGuardado = true;
      }
      if (local) {
        try {
          // Jamás elimina fotos, firmas, logo ni datos de la empresa del registro local.
          await guardarOrdenLocal({
            ...local,
            form: {
              ...(local.form || {}), ...form,
              folio_orden: comoTexto(original.folio_orden)
            }
          });
        } catch (e) {
          Alert.alert('Orden actualizada en PostgreSQL',
            'Se guardaron los cambios del servidor, pero no se pudo actualizar la copia local del teléfono. ' +
            'Las fotografías y firmas existentes no se eliminaron. Detalle: ' + (e?.message || 'Error desconocido'),
            [{ text: 'Aceptar', onPress: () => navigation.replace('OrderDetail', { orden: registro }) }]);
          return;
        }
      }
      const mensaje = remotoGuardado
        ? 'Los cambios se guardaron en PostgreSQL sin cambiar el folio. Fotografías y firmas permanecen en este teléfono.'
        : 'No se detectaron cambios para enviar al servidor.';
      Alert.alert('Orden actualizada', mensaje, [
        { text: 'Aceptar', onPress: () => navigation.replace('OrderDetail', { orden: registro }) }
      ]);
    } catch (error) {
      const mensaje = error?.response?.data?.error || error?.message || 'No se pudo guardar.';
      Alert.alert('No se pudo guardar la edición', String(mensaje));
    } finally { setGuardando(false); }
  };

  const input = ([etiqueta, campo]) => {
    const multiline = ['observaciones', 'recomendaciones', 'reporte', 'material_refacciones', 'simulador'].includes(campo);
    return <View key={campo} style={styles.campo}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multiline]}
        value={comoTexto(form[campo])}
        onChangeText={texto => setForm(prev => ({ ...prev, [campo]: texto }))}
        editable={!guardando && !cargando}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholder={etiqueta}
        placeholderTextColor="#94a3b8"
      />
    </View>;
  };

  return <ScrollView contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled">
    <Text style={styles.titulo}>{titulo}</Text>
    <Text style={styles.nota}>El número de folio no se puede editar. Las modificaciones en los campos principales se guardan en PostgreSQL y quedan auditadas.</Text>
    {!idValido && <Text style={styles.error}>No hay un ID válido de PostgreSQL para esta orden.</Text>}
    {cargando ? <ActivityIndicator size="large" color="#20548a" /> : <>
      {CAMPOS.map(input)}
      <Text style={styles.subtitulo}>Informe técnico</Text>
      <Text style={styles.nota}>Reporte, material, pruebas eléctricas y simulador se guardan en PostgreSQL.</Text>
      {CAMPOS_TECNICOS.map(input)}
      {pendientesPorSincronizar && <Text style={styles.nota}>Hay información antigua guardada solo en este teléfono. Pulsa Guardar para sincronizarla con PostgreSQL.</Text>}
      <Text style={styles.nota}>Las fotografías y firmas continúan almacenadas únicamente en este teléfono; no se eliminan al editar.</Text>
      <TouchableOpacity disabled={!idValido || !tieneCambios || guardando} style={[styles.boton, (!idValido || !tieneCambios || guardando) && styles.desactivado]} onPress={guardar}>
        <Text style={styles.botonTexto}>{guardando ? 'Guardando cambios...' : 'Guardar cambios de la orden'}</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={guardando} style={styles.cancelar} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelarTexto}>Cancelar</Text>
      </TouchableOpacity>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  contenido: { padding: 16, paddingBottom: 44, backgroundColor: '#f8fafc', flexGrow: 1 },
  titulo: { color: '#20548a', fontWeight: '800', fontSize: 22, marginBottom: 12 },
  subtitulo: { color: '#20548a', fontWeight: '800', fontSize: 17, marginTop: 22, marginBottom: 10 },
  campo: { marginBottom: 12 },
  etiqueta: { fontSize: 13, fontWeight: '700', color: '#243447', marginBottom: 6 },
  input: { borderColor: '#cbd5e1', borderWidth: 1, borderRadius: 8, backgroundColor: '#fff', minHeight: 46, padding: 11, color: '#142b49' },
  multiline: { minHeight: 100 },
  nota: { color: '#64748b', fontSize: 13, lineHeight: 19, marginBottom: 14 },
  error: { color: '#a42525', marginBottom: 14 },
  boton: { backgroundColor: '#20548a', padding: 15, borderRadius: 8, marginTop: 16, alignItems: 'center' },
  desactivado: { opacity: 0.5 },
  botonTexto: { fontWeight: '800', color: '#fff', textAlign: 'center', fontSize: 15 },
  cancelar: { padding: 14, marginTop: 12, alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8 },
  cancelarTexto: { color: '#20548a', fontWeight: '700' }
});
