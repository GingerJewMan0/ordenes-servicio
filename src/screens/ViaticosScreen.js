import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native';
import { EMPRESAS } from '../services/api';
import { eliminarViatico, listarViaticos } from '../services/viaticosLocal';
import {
  listarViaticosServidor, crearViaticoServidor, actualizarViaticoServidor,
  eliminarViaticoServidor, explicarErrorViaticos
} from '../services/viaticosApi';
import { compartirPdfViaticos, generarPdfViaticos } from '../services/pdfViaticos';

const RUBROS = [
  { id: 'casetas', nombre: 'Casetas' },
  { id: 'estacionamiento', nombre: 'Estacionamiento' },
  { id: 'gasolina', nombre: 'Gasolina' },
  { id: 'hospedaje', nombre: 'Hospedaje' },
  { id: 'comida', nombre: 'Comida' },
  { id: 'refacciones', nombre: 'Refacciones' },
  { id: 'material', nombre: 'Material' },
  { id: 'otros', nombre: 'Otros' }
];
const hoyLocal = () => {
  const fecha = new Date();
  const p = (numero) => String(numero).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
};
const gastosVacios = () => Object.fromEntries(RUBROS.map(({ id }) => [id, '']));
const formularioVacio = () => ({
  empresaId: EMPRESAS[0]?.id || 'opciones',
  folio: '', empleado: '', destino: '', fechaInicio: hoyLocal(), fechaFin: hoyLocal(),
  ordenRelacionada: '', motivo: '', observaciones: '', gastos: gastosVacios()
});
const formatoMoneda = (importe) => `$${Number(importe || 0).toFixed(2)} MXN`;
const importeNumero = (valor) => {
  const texto = String(valor ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!texto) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(texto)) return null;
  const monto = Number(texto);
  if (!Number.isFinite(monto) || monto > 999999999) return null;
  return Math.round(monto * 100) / 100;
};
const fechaValida = (valor) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
};
function Campo({ titulo, valor, cambio, multiline = false, teclado = 'default', placeholder = '' }) {
  return (
    <View style={styles.campo}>
      <Text style={styles.etiqueta}>{titulo}</Text>
      <TextInput value={valor} onChangeText={cambio} placeholder={placeholder}
        placeholderTextColor="#8492a5" keyboardType={teclado} multiline={multiline}
        numberOfLines={multiline ? 3 : 1} textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.entrada, multiline && styles.areaTexto]} />
    </View>
  );
}

export default function ViaticosScreen() {
  const desplazamiento = useRef(null);
  const guardadoEnCurso = useRef(false);
  const idPeticion = useRef(null);
  const [form, setForm] = useState(formularioVacio);
  const [editarId, setEditarId] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [antiguosLocales, setAntiguosLocales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [errorServidor, setErrorServidor] = useState('');
  const empresaSeleccionada = EMPRESAS.find((e) => e.id === form.empresaId) || EMPRESAS[0];

  const actualizar = (campo, valor) => setForm((actual) => ({ ...actual, [campo]: valor }));
  const actualizarRubro = (campo, valor) => setForm((actual) => ({
    ...actual, gastos: { ...actual.gastos, [campo]: valor }
  }));
  const recargar = async () => {
    const [servidor, locales] = await Promise.allSettled([listarViaticosServidor(), listarViaticos()]);
    if (servidor.status === 'fulfilled') {
      setHistorial(servidor.value);
      setErrorServidor('');
    } else {
      setErrorServidor(explicarErrorViaticos(servidor.reason));
    }
    if (locales.status === 'fulfilled') setAntiguosLocales(locales.value);
  };
  useEffect(() => {
    let activo = true;
    Promise.allSettled([listarViaticosServidor(), listarViaticos()]).then(([s, l]) => {
      if (!activo) return;
      if (s.status === 'fulfilled') setHistorial(s.value);
      else setErrorServidor(explicarErrorViaticos(s.reason));
      if (l.status === 'fulfilled') setAntiguosLocales(l.value);
    }).finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  const importes = useMemo(() => {
    const resultado = {};
    RUBROS.forEach(({ id }) => { resultado[id] = importeNumero(form.gastos[id]); });
    return resultado;
  }, [form.gastos]);
  const hayImporteInvalido = Object.values(importes).some((valor) => valor === null);
  const total = hayImporteInvalido ? null : Object.values(importes).reduce((suma, valor) => suma + valor, 0);
  const validar = () => {
    if (!form.empleado.trim()) return 'Escribe el nombre del empleado.';
    if (!form.destino.trim()) return 'Escribe el destino del viaje.';
    if (!form.motivo.trim()) return 'Describe el motivo de la comisión.';
    if (!fechaValida(form.fechaInicio) || !fechaValida(form.fechaFin)) return 'Revisa las fechas en formato AAAA-MM-DD.';
    if (form.fechaFin < form.fechaInicio) return 'La fecha de regreso no puede ser anterior a la salida.';
    if (hayImporteInvalido) return 'Revisa los importes; utiliza máximo dos decimales.';
    return null;
  };
  const construirSolicitud = () => ({
    empresaId: form.empresaId, empleado: form.empleado.trim(), destino: form.destino.trim(),
    fechaInicio: form.fechaInicio, fechaFin: form.fechaFin,
    ordenRelacionada: form.ordenRelacionada.trim(), motivo: form.motivo.trim(),
    observaciones: form.observaciones.trim(), gastos: { ...importes }
  });
  const nuevo = () => {
    idPeticion.current = null;
    setForm(formularioVacio()); setEditarId(null);
    desplazamiento.current?.scrollTo({ y: 0, animated: true });
  };

  const guardar = async (conPdf) => {
    if (ocupado || guardadoEnCurso.current) return;
    const error = validar();
    if (error) return Alert.alert('Revisa la solicitud', error);
    guardadoEnCurso.current = true;
    setOcupado(true);
    let confirmado;
    try {
      if (editarId) {
        confirmado = await actualizarViaticoServidor(editarId, construirSolicitud());
      } else {
        // Si una llamada se interrumpe, el mismo ID evita insertar dos veces por reintento.
        if (!idPeticion.current) idPeticion.current = `android_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        confirmado = await crearViaticoServidor(construirSolicitud(), idPeticion.current);
      }
      idPeticion.current = null;
      setEditarId(confirmado.id);
      setForm((actual) => ({ ...actual, folio: confirmado.folio }));
      setHistorial((actual) => [confirmado, ...actual.filter((v) => String(v.id) !== String(confirmado.id))]);
      setErrorServidor('');
    } catch (fallo) {
      Alert.alert('No se confirmó el guardado', explicarErrorViaticos(fallo));
      guardadoEnCurso.current = false;
      setOcupado(false);
      return;
    }
    try {
      if (conPdf) {
        const uri = await generarPdfViaticos(confirmado);
        await compartirPdfViaticos(uri);
      } else {
        Alert.alert('Viático guardado en PostgreSQL', `Folio asignado: ${confirmado.folio}`);
      }
      await recargar();
    } catch (errorPdf) {
      Alert.alert('Viático guardado', `Folio ${confirmado.folio} confirmado en PostgreSQL. El PDF no pudo generarse o compartirse: ${errorPdf.message}. Puedes usar el botón PDF del historial.`);
    } finally {
      guardadoEnCurso.current = false;
      setOcupado(false);
    }
  };

  const editar = (item) => {
    idPeticion.current = null;
    setEditarId(item.id);
    setForm({ empresaId: item.empresaId, folio: String(item.folio || ''),
      empleado: String(item.empleado || ''), destino: String(item.destino || ''),
      fechaInicio: String(item.fechaInicio || hoyLocal()), fechaFin: String(item.fechaFin || hoyLocal()),
      ordenRelacionada: String(item.ordenRelacionada || ''), motivo: String(item.motivo || ''),
      observaciones: String(item.observaciones || ''),
      gastos: Object.fromEntries(RUBROS.map(({ id }) => [id, String(item.gastos?.[id] || '')]))
    });
    desplazamiento.current?.scrollTo({ y: 0, animated: true });
  };
  const compartir = async (item) => {
    if (ocupado) return;
    setOcupado(true);
    try { const uri = await generarPdfViaticos(item); await compartirPdfViaticos(uri); }
    catch (error) { Alert.alert('No se pudo compartir el PDF', error.message); }
    finally { setOcupado(false); }
  };
  const confirmarEliminar = (item, esLocal = false) => {
    Alert.alert('Eliminar viático', `¿Eliminar ${item.folio}? El folio no se reutilizará.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        setOcupado(true);
        try {
          if (esLocal) {
            await eliminarViatico(item.id);
            setAntiguosLocales(await listarViaticos());
          } else {
            await eliminarViaticoServidor(item.id);
            setHistorial((actual) => actual.filter((v) => String(v.id) !== String(item.id)));
          }
          if (!esLocal && String(editarId) === String(item.id)) nuevo();
        } catch (error) { Alert.alert('No se pudo eliminar', explicarErrorViaticos(error)); }
        finally { setOcupado(false); }
      }}
    ]);
  };
  return (
    <ScrollView ref={desplazamiento} style={styles.pantalla} contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled">
      <Text style={styles.titulo}>Solicitud de viáticos</Text>
      <Text style={styles.ayuda}>Registra gastos; PostgreSQL asigna el folio V-0001, V-0002... al guardar.</Text>
      {errorServidor ? <View style={styles.aviso}><Text style={styles.avisoTexto}>{errorServidor}</Text></View> : null}
      <View style={styles.tarjeta}>
        <Text style={styles.subtitulo}>Empresa que solicita</Text>
        {EMPRESAS.map((empresa) => (
          <TouchableOpacity key={empresa.id} style={[styles.empresaOpcion, empresa.id === form.empresaId && styles.empresaSeleccionada]}
            onPress={() => actualizar('empresaId', empresa.id)} disabled={ocupado} accessibilityRole="radio"
            accessibilityState={{ checked: empresa.id === form.empresaId }}>
            <Text style={styles.empresaTexto}>{empresa.id === form.empresaId ? '◉' : '○'} {empresa.nombre}</Text>
          </TouchableOpacity>
        ))}
        {empresaSeleccionada?.logo ? (
          <Image style={styles.logo} source={typeof empresaSeleccionada.logo === 'number' ? empresaSeleccionada.logo : { uri: empresaSeleccionada.logo }} resizeMode="contain" />
        ) : null}
        <View style={styles.campo}>
          <Text style={styles.etiqueta}>Folio de viáticos (automático)</Text>
          <View style={styles.entrada}><Text style={{ color: '#173753' }}>{form.folio || 'Se asigna al guardar en PostgreSQL'}</Text></View>
        </View>
        <Campo titulo="Nombre del empleado / técnico" valor={form.empleado} cambio={(v) => actualizar('empleado', v)} />
        <Campo titulo="Destino" valor={form.destino} cambio={(v) => actualizar('destino', v)} placeholder="Ciudad o unidad médica" />
        <View style={styles.fechas}>
          <View style={styles.fechaCol}><Campo titulo="Fecha de salida" valor={form.fechaInicio} cambio={(v) => actualizar('fechaInicio', v)} placeholder="AAAA-MM-DD" /></View>
          <View style={styles.fechaCol}><Campo titulo="Fecha de regreso" valor={form.fechaFin} cambio={(v) => actualizar('fechaFin', v)} placeholder="AAAA-MM-DD" /></View>
        </View>
        <Campo titulo="Folio de orden de servicio (opcional)" valor={form.ordenRelacionada} cambio={(v) => actualizar('ordenRelacionada', v)} />
        <Campo titulo="Motivo de la comisión" valor={form.motivo} cambio={(v) => actualizar('motivo', v)} multiline />
      </View>
      <View style={styles.tarjeta}>
        <Text style={styles.subtitulo}>Desglose de gastos</Text>
        <Text style={styles.ayuda}>Importes en MXN. Usa números sin separador de miles y hasta dos decimales.</Text>
        {RUBROS.map(({ id, nombre }) => (
          <Campo key={id} titulo={nombre} valor={form.gastos[id]} cambio={(v) => actualizarRubro(id, v)} teclado="decimal-pad" placeholder="0.00" />
        ))}
        <View style={styles.totalFila}>
          <Text style={styles.totalEtiqueta}>Total solicitado</Text>
          <Text style={styles.totalValor}>{total === null ? 'Importe inválido' : formatoMoneda(total)}</Text>
        </View>
        <Campo titulo="Observaciones (opcional)" valor={form.observaciones} cambio={(v) => actualizar('observaciones', v)} multiline />
      </View>
      <TouchableOpacity style={[styles.boton, ocupado && styles.desactivado]} disabled={ocupado} onPress={() => guardar(false)}>
        <Text style={styles.botonTexto}>{ocupado ? 'Guardando...' : editarId ? 'Guardar cambios en PostgreSQL' : 'Guardar en PostgreSQL'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.boton, styles.botonPdf, ocupado && styles.desactivado]} disabled={ocupado} onPress={() => guardar(true)}>
        <Text style={styles.botonTexto}>Guardar y compartir PDF</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={nuevo} disabled={ocupado} style={styles.botonNuevo}>
        <Text style={styles.nuevoTexto}>+ Nueva solicitud</Text>
      </TouchableOpacity>
      <View style={styles.tarjeta}>
        <Text style={styles.subtitulo}>Historial de viáticos (PostgreSQL)</Text>
        <TouchableOpacity disabled={ocupado} onPress={recargar}><Text style={styles.accion}>Actualizar historial</Text></TouchableOpacity>
        {cargando ? <ActivityIndicator color="#15558e" /> : historial.length === 0 ? (
          <Text style={styles.ayuda}>No hay viáticos recuperados del servidor.</Text>
        ) : historial.map((item) => (
          <View key={String(item.id)} style={styles.historialFila}>
            <Text style={styles.historialFolio}>{item.folio} · {formatoMoneda(item.total)}</Text>
            <Text style={styles.historialDetalle}>{item.empleado} · {item.destino}</Text>
            <View style={styles.acciones}>
              <TouchableOpacity disabled={ocupado} onPress={() => editar(item)}><Text style={styles.accion}>Editar</Text></TouchableOpacity>
              <TouchableOpacity disabled={ocupado} onPress={() => compartir(item)}><Text style={styles.accion}>PDF</Text></TouchableOpacity>
              <TouchableOpacity disabled={ocupado} onPress={() => confirmarEliminar(item)}><Text style={styles.accionBorrar}>Eliminar</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
      {antiguosLocales.length ? <View style={styles.tarjeta}>
        <Text style={styles.subtitulo}>Viáticos anteriores (solo en este teléfono)</Text>
        <Text style={styles.ayuda}>Son históricos de la versión anterior. No se suben automáticamente a PostgreSQL y se conservan con sus categorías originales.</Text>
        {antiguosLocales.map((item) => (
          <View key={String(item.id)} style={styles.historialFila}>
            <Text style={styles.historialFolio}>{item.folio} · {formatoMoneda(item.total)}</Text>
            <Text style={styles.historialDetalle}>{item.empleado} · {item.destino}</Text>
            <View style={styles.acciones}>
              <TouchableOpacity disabled={ocupado} onPress={() => compartir(item)}><Text style={styles.accion}>PDF histórico</Text></TouchableOpacity>
              <TouchableOpacity disabled={ocupado} onPress={() => confirmarEliminar(item, true)}><Text style={styles.accionBorrar}>Eliminar local</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </View> : null}
      <Text style={styles.advertencia}>Los nuevos viáticos se guardan en PostgreSQL. Para usarlos desde otros teléfonos, el servidor debe estar disponible y protegido con usuarios y permisos.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#f5f7fb' },
  contenido: { padding: 16, paddingBottom: 34 },
  titulo: { fontSize: 23, fontWeight: '800', color: '#123b61', marginBottom: 6 },
  subtitulo: { fontSize: 17, fontWeight: '700', color: '#164a72', marginBottom: 11 },
  ayuda: { fontSize: 13, color: '#63758b', lineHeight: 19, marginBottom: 12 },
  tarjeta: { backgroundColor: '#fff', borderRadius: 13, padding: 15, marginTop: 16, elevation: 2 },
  campo: { marginBottom: 13 }, etiqueta: { fontWeight: '700', color: '#25364a', fontSize: 13, marginBottom: 6 },
  entrada: { borderWidth: 1, borderColor: '#ccd5df', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10, minHeight: 43, color: '#182b3e', backgroundColor: '#fff', fontSize: 15 },
  areaTexto: { minHeight: 82 }, empresaOpcion: { borderWidth: 1, borderColor: '#d7e1eb', padding: 11, borderRadius: 9, marginBottom: 7 },
  empresaSeleccionada: { borderColor: '#2471af', backgroundColor: '#edf6fd' },
  empresaTexto: { fontWeight: '600', fontSize: 14, color: '#203b56' },
  logo: { width: 200, height: 83, alignSelf: 'center', marginVertical: 10 },
  fechas: { flexDirection: 'row', gap: 10 }, fechaCol: { flex: 1, minWidth: 0 },
  totalFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#e8f3fc', padding: 13, borderRadius: 9, marginVertical: 12, gap: 10 },
  totalEtiqueta: { color: '#144b73', fontWeight: '800', flex: 1 }, totalValor: { color: '#144b73', fontWeight: '800', fontSize: 16, flexShrink: 1 },
  boton: { backgroundColor: '#2067a3', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 14 },
  botonPdf: { backgroundColor: '#16745d', marginTop: 10 }, desactivado: { opacity: 0.55 },
  botonTexto: { color: '#fff', fontSize: 15, fontWeight: '800' }, botonNuevo: { alignItems: 'center', padding: 16 },
  nuevoTexto: { fontWeight: '700', color: '#2067a3' },
  historialFila: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  historialFolio: { color: '#164a72', fontSize: 14, fontWeight: '700' },
  historialDetalle: { color: '#475569', fontSize: 13, marginTop: 4 },
  acciones: { flexDirection: 'row', gap: 24, marginTop: 10 },
  accion: { color: '#2067a3', fontWeight: '700' }, accionBorrar: { color: '#ba2929', fontWeight: '700' },
  aviso: { backgroundColor: '#fff3e1', borderWidth: 1, borderColor: '#edbf75', borderRadius: 8, padding: 12, marginTop: 8 },
  avisoTexto: { color: '#784b0a', fontSize: 13 },
  advertencia: { textAlign: 'center', fontSize: 12, color: '#77879a', lineHeight: 18, marginTop: 16 }
});
