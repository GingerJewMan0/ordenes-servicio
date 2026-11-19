import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import { API_URL, eliminarOrdenEnServidor, empresaDeRegistro } from '../services/api';
import { leerOrdenLocalAsociada, guardarEstadoSincronizacion } from '../services/ordenesLocales';
import { cargarGaleriaRemota, sincronizarCapturaInicial } from '../services/evidenciasApi';
import { compartirPdfOrden } from '../services/pdfOrden';

const camposInformeTecnico = [
  'reporte', 'material_refacciones', 'pruebas_electricas', 'simulador'
];

function datosCombinados(remotos, local) {
  // No sobrescribir lo que ya está en PostgreSQL con una copia local antigua.
  // Para registros históricos con columnas NULL sí conservar el texto local.
  const extras = {};
  for (const campo of camposInformeTecnico) {
    extras[campo] = remotos?.[campo] ?? local?.form?.[campo] ?? '';
  }
  return {
    ...(local?.form || {}), ...remotos, ...extras,
    // El backend almacena recomendaciones en su columna heredada.
    recomendaciones: remotos?.observaciones_mtto_correctivo ?? local?.form?.recomendaciones ?? '',
    marca_modelo: [remotos?.marca, remotos?.modelo].filter(Boolean).join(' / ') || local?.form?.marca_modelo || ''
  };
}

export default function OrderDetailScreen({ route, navigation, rolUsuario }) {
  const inicial = route.params?.orden || {};
  const [ordenRemota, setOrdenRemota] = useState(inicial);
  const [local, setLocal] = useState(null);
  const [galeriaRemota, setGaleriaRemota] = useState(null);
  const [avisoEvidencias, setAvisoEvidencias] = useState('');
  const [sincronizando, setSincronizando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [compartiendo, setCompartiendo] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [avisoCarga, setAvisoCarga] = useState('');
  const [consultaServidorConfirmada, setConsultaServidorConfirmada] = useState(false);
  const id = Number(ordenRemota?.id ?? inicial?.id);
  const idValido = Number.isSafeInteger(id) && id > 0;
  const esAdmin = rolUsuario === 'admin';

  const cargar = useCallback(async () => {
    setCargando(true);
    setConsultaServidorConfirmada(false);
    try {
      if (!Number.isSafeInteger(Number(inicial.id)) || Number(inicial.id) <= 0) {
        throw new Error('La orden no tiene un ID confirmado de PostgreSQL.');
      }
      // Reconsultar por ID; el folio no identifica por sí mismo una copia local.
      const respuesta = await axios.get(`${API_URL}/${inicial.id}`, { timeout: 90000 });
      const reciente = respuesta?.data;
      if (!reciente || Number(reciente.id) !== Number(inicial.id)) {
        throw new Error('El servidor no confirmó la identidad de la orden.');
      }
      setOrdenRemota(reciente);
      setConsultaServidorConfirmada(true);
      setAvisoCarga('');
      try {
        const empresa = empresaDeRegistro(reciente);
        const valor = await leerOrdenLocalAsociada(
          reciente.folio_orden, reciente.id, empresa?.id || null
        );
        setLocal(valor || null);
      } catch (e) {
        console.warn('No se pudieron leer evidencias locales:', e?.message);
        setLocal(null);
      }
      // Las imágenes son privadas; se descargan con la sesión de Axios y
      // se guardan únicamente en la caché interna del dispositivo.
      if (Number.isSafeInteger(Number(reciente?.id)) && Number(reciente.id) > 0) {
        try {
          const remotas = await cargarGaleriaRemota(reciente.id);
          setGaleriaRemota(remotas.galeria);
          setAvisoEvidencias(remotas.errores.length
            ? `${remotas.errores.length} evidencia(s) remota(s) no se pudieron descargar.`
            : '');
        } catch (e) {
          setGaleriaRemota(null);
          setAvisoEvidencias('No se pudieron consultar las evidencias remotas; se usará la copia local si existe.');
        }
      } else {
        setGaleriaRemota(null);
        setAvisoEvidencias('');
      }
    } catch (e) {
      console.warn('No se pudo actualizar el detalle:', e?.message);
      setAvisoCarga('No se pudo actualizar desde el servidor; se muestran los datos disponibles.');
      setGaleriaRemota(null);
      setAvisoEvidencias('');
      // No asociar archivos locales por folio si la consulta remota falló.
      setLocal(null);
    } finally { setCargando(false); }
  }, [inicial.id, inicial.folio_orden, inicial.empresaId]);

  useEffect(() => {
    cargar();
    const quitar = navigation.addListener('focus', cargar);
    return quitar;
  }, [navigation, cargar]);

  const datos = datosCombinados(ordenRemota, local);
  const evidenciasVisuales = {
    fotosAntes: (galeriaRemota?.fotosAntes?.length || 0) >= (local?.fotosAntes?.length || 0) &&
      galeriaRemota?.fotosAntes?.length ? galeriaRemota.fotosAntes : (local?.fotosAntes || []),
    fotosDespues: (galeriaRemota?.fotosDespues?.length || 0) >= (local?.fotosDespues?.length || 0) &&
      galeriaRemota?.fotosDespues?.length ? galeriaRemota.fotosDespues : (local?.fotosDespues || []),
    firmaTecnico: galeriaRemota?.firmaTecnico || local?.firmaTecnico || null,
    firmaResponsable: galeriaRemota?.firmaResponsable || local?.firmaResponsable || null
  };
  // PostgreSQL determina el membrete; NUNCA la empresa guardada en Android.
  const empresaRegistrada = empresaDeRegistro(ordenRemota);
  const empresaIdPdf = empresaRegistrada?.id || null;
  const empresaEnConflicto = !!(local?.empresaId && empresaIdPdf &&
    local.empresaId !== empresaIdPdf);

  const reintentar = async () => {
    // Solo una orden nueva creada desde este dispositivo y con ID confirmado.
    if (!local || !idValido || Number(local.backendId) !== id ||
        local.sincronizacionEvidencias === 'cerrada' || sincronizando) return;
    setSincronizando(true);
    try {
      await sincronizarCapturaInicial(id, local);
      await guardarEstadoSincronizacion(ordenRemota.folio_orden, local.empresaId, id, 'cerrada');
      Alert.alert('Respaldo completado', 'Evidencias sincronizadas y captura cerrada.');
      await cargar();
    } catch (e) {
      const mensaje = String(e?.response?.data?.error || e?.message || 'Error de sincronización');
      try {
        await guardarEstadoSincronizacion(ordenRemota.folio_orden, local.empresaId, id, 'pendiente', mensaje);
      } catch (_) {}
      Alert.alert('Sincronización pendiente', mensaje + '. No crees otra orden para reintentar.');
    } finally { setSincronizando(false); }
  };

  const compartir = async () => {
    setCompartiendo(true);
    try {
      if (!consultaServidorConfirmada || !empresaRegistrada) {
        throw new Error('No se pudo confirmar la empresa en PostgreSQL. No se generará un PDF con membrete ambiguo.');
      }
      if (empresaEnConflicto) {
        throw new Error('La copia local y PostgreSQL tienen empresas distintas. Se requiere revisión administrativa antes de emitir este PDF.');
      }
      const base = local || {};
      // Usar imágenes privadas disponibles, pero NUNCA el membrete local.
      // Las copias de Android no se modifican ni eliminan.
      await compartirPdfOrden({
        ...base, ...evidenciasVisuales,
        empresaId: empresaRegistrada.id,
        logo: empresaRegistrada.logo,
        contactoEmpresa: { ...empresaRegistrada.contacto },
        form: { ...datos, empresa: empresaRegistrada.nombre }
      });
    } catch (error) {
      Alert.alert('Error al compartir el PDF', error?.message || 'No se pudo generar el documento.');
    } finally { setCompartiendo(false); }
  };

  const eliminar = () => {
    if (!esAdmin || !idValido || eliminando) return;
    Alert.alert(
      'Eliminar orden',
      `¿Deseas retirar del historial la orden #${ordenRemota.folio_orden ?? '—'}? El registro seguirá en PostgreSQL para auditoría.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar orden', style: 'destructive', onPress: async () => {
          setEliminando(true);
          try {
            await eliminarOrdenEnServidor(id);
            Alert.alert('Orden eliminada', 'Se retiró del historial y quedó registrada en la auditoría.', [
              { text: 'Aceptar', onPress: () => navigation.popToTop() }
            ]);
          } catch (error) {
            const mensaje = error?.response?.data?.error || error?.message || 'No se pudo eliminar.';
            Alert.alert('No se pudo eliminar', String(mensaje));
          } finally { setEliminando(false); }
        } }
      ]
    );
  };

  const fila = (titulo, valor) => <Text style={styles.fila} key={titulo}>
    <Text style={styles.negrita}>{titulo}: </Text>{String(valor ?? '').trim() || '—'}
  </Text>;

  const galeria = (titulo, fotos) => <View>
    <Text style={styles.subtitulo}>{titulo} ({fotos.length})</Text>
    <View style={styles.imagenes}>
      {fotos.map((uri, i) => <Image key={`${uri}-${i}`} style={styles.foto} source={{ uri }} />)}
    </View>
  </View>;

  return <ScrollView contentContainerStyle={styles.contenido}>
    <Text style={styles.titulo}>Orden #{ordenRemota.folio_orden ?? '—'}</Text>
    {!!avisoCarga && <Text style={styles.aviso}>{avisoCarga}</Text>}
    {fila('Unidad médica', datos.nombre_unidad_medica)}
    {fila('Equipo', datos.equipo)}
    {fila('Marca y Modelo', datos.marca_modelo)}
    {fila('N/S', datos.serie)}
    {fila('Inventario', datos.inventario)}
    {fila('Motivo de visita', datos.motivo_servicio)}
    {fila('No. de contrato / Programa', datos.no_contrato)}
    <Text style={styles.subtitulo}>Informe técnico</Text>
    {fila('Reporte', datos.reporte)}
    {fila('Observaciones', datos.observaciones)}
    {fila('Recomendaciones', datos.recomendaciones)}
    {fila('Material y refacciones utilizadas', datos.material_refacciones)}
    {fila('Pruebas eléctricas', datos.pruebas_electricas)}
    {fila('Simulador', datos.simulador)}
    {cargando ? <ActivityIndicator /> : <>
      {!!empresaRegistrada && <>
        {fila('Empresa', empresaRegistrada.nombre)}
        {fila('Dirección de la empresa', empresaRegistrada.contacto?.direccion)}
        {fila('Teléfono de la empresa', empresaRegistrada.contacto?.telefono)}
        {fila('Email de la empresa', empresaRegistrada.contacto?.email)}
      </>}
      {!empresaRegistrada && <Text style={styles.aviso}>
        La empresa del servidor no es reconocida. No se emitirá un PDF hasta revisarla.
      </Text>}
      {empresaEnConflicto && <Text style={styles.aviso}>
        Existe una diferencia histórica entre la empresa local y PostgreSQL. La orden
        se muestra con la empresa del servidor; no se emitirá PDF hasta conciliarla.
      </Text>}
      {!!empresaRegistrada?.logo && <Image style={styles.logo}
        source={typeof empresaRegistrada.logo === 'number'
          ? empresaRegistrada.logo : { uri: empresaRegistrada.logo }}
        resizeMode="contain" />}
      {!!avisoEvidencias && <Text style={styles.aviso}>{avisoEvidencias}</Text>}
      {galeria('Fotos ANTES', evidenciasVisuales.fotosAntes)}
      {galeria('Fotos DESPUÉS', evidenciasVisuales.fotosDespues)}
      <Text style={styles.subtitulo}>Firma del técnico</Text>
      {!!evidenciasVisuales.firmaTecnico && <Image source={{ uri: evidenciasVisuales.firmaTecnico }}
        style={styles.firma} resizeMode="contain" />}
      <Text style={styles.subtitulo}>Firma del responsable</Text>
      {!!evidenciasVisuales.firmaResponsable && <Image source={{ uri: evidenciasVisuales.firmaResponsable }}
        style={styles.firma} resizeMode="contain" />}
      <Text style={styles.nota}>Se muestran las evidencias disponibles desde el servidor privado;
        en caso de fallo se conserva la copia local del dispositivo.</Text>
      {!!local && local.sincronizacionEvidencias !== 'cerrada' && Number(local.backendId) === id &&
        <TouchableOpacity onPress={reintentar} disabled={sincronizando} style={styles.boton}>
          <Text style={styles.botonTexto}>{sincronizando ? 'Sincronizando...' :
            'Reintentar respaldo pendiente (sin crear otra orden)'}</Text>
        </TouchableOpacity>}
    </>}

{esAdmin && (
  <TouchableOpacity
    onPress={() =>
      navigation.navigate('EditOrder', {
        orden: ordenRemota,
        evidenciaLocal: local
      })
    }
    disabled={cargando || !idValido || eliminando}
    style={[styles.boton, styles.editar]}
  >
    <Text style={styles.botonTexto}>Editar orden</Text>
  </TouchableOpacity>
)}

    <TouchableOpacity onPress={compartir}
      disabled={compartiendo || cargando || eliminando ||
        !consultaServidorConfirmada || !empresaIdPdf || empresaEnConflicto}
      style={styles.boton}>
      <Text style={styles.botonTexto}>{compartiendo ? 'Preparando PDF...' : 'Compartir copia PDF'}</Text>
    </TouchableOpacity>
    {esAdmin && <TouchableOpacity
      onPress={eliminar}
      disabled={!idValido || cargando || eliminando}
      style={[styles.boton, styles.eliminar]}
    >
      <Text style={styles.botonTexto}>{eliminando ? 'Eliminando...' : 'Eliminar orden (solo administrador)'}</Text>
    </TouchableOpacity>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  contenido: { backgroundColor: '#f8fafc', flexGrow: 1, padding: 18, paddingBottom: 40 },
  titulo: { fontSize: 22, fontWeight: '800', color: '#20548a', marginBottom: 15 },
  fila: { fontSize: 14, color: '#243447', paddingVertical: 5 },
  negrita: { fontWeight: 'bold' },
  subtitulo: { fontWeight: '800', color: '#20548a', marginTop: 16, marginBottom: 8 },
  nota: { color: '#64748b', lineHeight: 19, marginTop: 14 },
  aviso: { color: '#9a3412', padding: 10, backgroundColor: '#fff7ed', marginBottom: 12 },
  imagenes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  foto: { height: 95, width: 95, borderRadius: 6 },
  firma: { height: 95, backgroundColor: '#fff' },
  logo: { height: 85, width: 220, marginVertical: 6 },
  boton: { backgroundColor: '#237448', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  editar: { backgroundColor: '#20548a' },
  eliminar: { backgroundColor: '#a72d2d', marginTop: 18 },
  botonTexto: { color: '#fff', fontWeight: 'bold', fontSize: 16, textAlign: 'center' }
});
