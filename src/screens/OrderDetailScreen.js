import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { leerOrdenLocal, nombreEmpresa } from '../services/ordenesLocales';
import { compartirPdfOrden } from '../services/pdfOrden';

export default function OrderDetailScreen({ route }) {
  const ordenRemota = route.params?.orden || {};
  const [local, setLocal] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [compartiendo, setCompartiendo] = useState(false);

  useEffect(() => {
    let activo = true;
    leerOrdenLocal(ordenRemota.folio_orden, ordenRemota.empresaId || null)
      .then((valor) => { if (activo) setLocal(valor); })
      .catch((error) => console.warn('Error al abrir evidencias:', error))
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [ordenRemota.folio_orden, ordenRemota.empresaId]);

  const compartir = async () => {
    setCompartiendo(true);
    try {
      // Si no hay evidencia local, genera una copia solo con datos de servidor.
      const datos = local || { form: ordenRemota, empresaId: ordenRemota.empresaId };
      await compartirPdfOrden(datos);
    } catch (error) {
      Alert.alert('Error al compartir el PDF', error.message);
    } finally {
      setCompartiendo(false);
    }
  };

  const fila = (titulo, valor) => <Text style={styles.fila} key={titulo}>
    <Text style={styles.negrita}>{titulo}: </Text>{String(valor ?? '').trim() || '—'}
  </Text>;
  const datos = local?.form || ordenRemota;

  const galeria = (titulo, fotos) => <View>
    <Text style={styles.subtitulo}>{titulo} ({fotos.length})</Text>
    <View style={styles.imagenes}>
      {fotos.map((uri) => <Image key={uri} style={styles.foto} source={{ uri }} />)}
    </View>
  </View>;

  return <ScrollView contentContainerStyle={styles.contenido}>
    <Text style={styles.titulo}>Orden #{ordenRemota.folio_orden ?? '—'}</Text>
    {fila('Unidad médica', datos.nombre_unidad_medica)}
    {fila('Equipo', datos.equipo)}
    {fila('Marca y Modelo', datos.marca_modelo || [datos.marca, datos.modelo].filter(Boolean).join(' / '))}
    {fila('N/S', datos.serie)}
    {fila('Inventario', datos.inventario)}
    {fila('Motivo de visita', datos.motivo_servicio)}
    {fila('No. de contrato / Programa', datos.no_contrato)}
    <Text style={styles.subtitulo}>Informe técnico</Text>
    {fila('Reporte', datos.reporte)}
    {fila('Observaciones', datos.observaciones)}
    {fila('Recomendaciones', datos.recomendaciones ?? datos.observaciones_mtto_correctivo)}
    {fila('Material y refacciones utilizadas', datos.material_refacciones)}
    {fila('Pruebas eléctricas', datos.pruebas_electricas)}
    {fila('Simulador', datos.simulador)}
    {cargando ? <ActivityIndicator /> : local ? <>
      {fila('Empresa', nombreEmpresa(local.empresaId))}
      {fila('Dirección de la empresa', local.contactoEmpresa?.direccion)}
      {fila('Teléfono de la empresa', local.contactoEmpresa?.telefono)}
      {fila('Email de la empresa', local.contactoEmpresa?.email)}
      {local.logo && <Image style={styles.logo} source={typeof local.logo === 'number' ? local.logo : { uri: local.logo }} resizeMode="contain" />}
      {galeria('Fotos ANTES', local.fotosAntes || [])}
      {galeria('Fotos DESPUÉS', local.fotosDespues || [])}
      <Text style={styles.subtitulo}>Firma del técnico</Text>
      {local.firmaTecnico && <Image source={{ uri: local.firmaTecnico }} style={styles.firma} resizeMode="contain" />}
      <Text style={styles.subtitulo}>Firma del responsable</Text>
      {local.firmaResponsable && <Image source={{ uri: local.firmaResponsable }} style={styles.firma} resizeMode="contain" />}
      <Text style={styles.nota}>Estas evidencias están guardadas exclusivamente en este dispositivo.</Text>
    </> : <Text style={styles.nota}>
      No hay firmas ni fotografías locales asociadas de forma inequívoca a este folio. El PDF contendrá únicamente los datos disponibles en el servidor.
    </Text>}
    <TouchableOpacity onPress={compartir} disabled={compartiendo || cargando} style={styles.boton}>
      <Text style={styles.botonTexto}>{compartiendo ? 'Preparando PDF...' : 'Compartir copia PDF'}</Text>
    </TouchableOpacity>
  </ScrollView>;
}

const styles = StyleSheet.create({
  contenido: { backgroundColor: '#f8fafc', flexGrow: 1, padding: 18, paddingBottom: 40 },
  titulo: { fontSize: 22, fontWeight: '800', color: '#20548a', marginBottom: 15 },
  fila: { fontSize: 14, color: '#243447', paddingVertical: 5 },
  negrita: { fontWeight: 'bold' },
  subtitulo: { fontWeight: '800', color: '#20548a', marginTop: 16, marginBottom: 8 },
  nota: { color: '#64748b', lineHeight: 19, marginTop: 14 },
  imagenes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  foto: { height: 95, width: 95, borderRadius: 6 },
  firma: { height: 95, backgroundColor: '#fff' },
  logo: { height: 85, width: 220, marginVertical: 6 },
  boton: { backgroundColor: '#237448', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 18 },
  botonTexto: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});
