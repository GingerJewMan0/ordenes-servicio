import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from 'react-native';
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';
import SignatureCanvas from 'react-native-signature-canvas';
import { API_URL, EMPRESAS, MOTIVOS, prepararOrdenServidor, folioDeRespuesta, idDeRespuesta, buscarFolioPorId } from '../services/api';
import { guardarFirma, guardarFoto, guardarOrdenLocal, guardarOrdenPendiente } from '../services/ordenesLocales';
import { compartirPdfOrden } from '../services/pdfOrden';

const FORM_INICIAL = {
  folio_orden: '', motivo_servicio: 'Mtto. Preventivo',
  nombre_unidad_medica: '', direccion: '', ubicacion: '', contacto: '',
  no_contrato: '', tel_unidad: '', tel_responsable: '', tiempo_garantia: '',
  equipo: '', marca: '', modelo: '', marca_modelo: '', serie: '', inventario: '',
  reporte: '', observaciones: '', recomendaciones: '',
  material_refacciones: '', pruebas_electricas: null, simulador: '',
  observaciones_mtto_correctivo: '',
  tecnico_servicio: '', responsable_unidad: ''
};

const MIN_FOTOS = 3; // 3 de antes + 3 de después = 6 como mínimo.
const ESTILO_FIRMA = `
  html, body { width: 100%; height: 100%; }
  .m-signature-pad { box-shadow: none; border: none; }
  .m-signature-pad--body { border: 1px solid #cbd5e1; }
  .m-signature-pad--footer { display: none; }
`;

export default function CreateOrderScreen({ navigation }) {
  const [form, setForm] = useState(FORM_INICIAL);
  const [empresaId, setEmpresaId] = useState(EMPRESAS[0].id);
  const empresaSeleccionada = EMPRESAS.find((e) => e.id === empresaId) || EMPRESAS[0];
  const logo = empresaSeleccionada.logo;
  const contactoEmpresa = empresaSeleccionada.contacto;
  const [fotosAntes, setFotosAntes] = useState([]);
  const [fotosDespues, setFotosDespues] = useState([]);
  const [firmaTecnico, setFirmaTecnico] = useState(null);
  const [firmaResponsable, setFirmaResponsable] = useState(null);
  const [motivosVisible, setMotivosVisible] = useState(false);
  const [firmaVisible, setFirmaVisible] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [guardada, setGuardada] = useState(false);
  const firmaRef = useRef(null);

  const handleChange = (campo, texto) => {
    setForm((anterior) => ({ ...anterior, [campo]: texto }));
  };

  const seleccionarEmpresa = (id) => {
    if (id === empresaId || ocupado || guardada) return;
    setEmpresaId(id);
  };

  const obtenerImagen = async (camara) => {
    if (camara) {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) {
        Alert.alert('Permiso requerido', 'Autoriza el uso de la cámara para tomar evidencias.');
        return null;
      }
    }
    const opciones = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.55,
      allowsEditing: false
    };
    const resultado = camara
      ? await ImagePicker.launchCameraAsync(opciones)
      : await ImagePicker.launchImageLibraryAsync(opciones);
    return resultado.canceled ? null : (resultado.assets?.[0] || null);
  };

  const agregarFoto = async (etapa, camara) => {
    if (ocupado || guardada) return;
    try {
      const asset = await obtenerImagen(camara);
      if (!asset) return;
      setOcupado(true);
      const uri = await guardarFoto(asset, etapa);
      if (etapa === 'antes') setFotosAntes((anterior) => [...anterior, uri]);
      else setFotosDespues((anterior) => [...anterior, uri]);
    } catch (error) {
      Alert.alert('No se pudo agregar la fotografía', error.message);
    } finally {
      setOcupado(false);
    }
  };

  const confirmarFirma = async (dataUrl) => {
    const tipo = firmaVisible;
    if (!tipo) return;
    try {
      setOcupado(true);
      const uri = await guardarFirma(dataUrl, tipo);
      if (tipo === 'tecnico') setFirmaTecnico(uri);
      else setFirmaResponsable(uri);
      setFirmaVisible(null);
    } catch (error) {
      Alert.alert('Error al guardar la firma', error.message);
    } finally {
      setOcupado(false);
    }
  };

  const armarOrdenLocal = (folio) => ({
    form: { ...form, folio_orden: String(folio ?? form.folio_orden ?? '') },
    empresaId, logo, contactoEmpresa: { ...contactoEmpresa },
    fotosAntes, fotosDespues, firmaTecnico, firmaResponsable
  });

  const validar = () => {
    if (!form.nombre_unidad_medica.trim() || !form.equipo.trim())
      return 'Completa la unidad médica y el equipo.';
    if (!form.tecnico_servicio.trim() || !form.responsable_unidad.trim())
      return 'Escribe el nombre del técnico y del responsable.';
    if (fotosAntes.length < MIN_FOTOS || fotosDespues.length < MIN_FOTOS)
      return 'Debes añadir al menos 3 fotografías de ANTES y 3 de DESPUÉS.';
    if (!firmaTecnico || !firmaResponsable)
      return 'Se necesitan las firmas del técnico y del responsable de la unidad.';
    if (!['Sí', 'No'].includes(form.pruebas_electricas))
      return 'Indica si se realizaron pruebas eléctricas (Sí o No).';
    return null;
  };


  const handleSubmit = async () => {
    if (ocupado || guardada) return;
    const problema = validar();
    if (problema) return Alert.alert('Falta información', problema);
    setOcupado(true);
    let respuesta;
    try {
      // El teléfono NO asigna folios a órdenes: debe hacerlo PostgreSQL.
      // El SQL adjunto instala un trigger que sustituye el 0 heredado de la API.
      respuesta = await axios.post(API_URL, prepararOrdenServidor(form), { timeout: 30000 });
    } catch (error) {
      setOcupado(false);
      Alert.alert('No se pudo confirmar el guardado',
        'Puede tratarse de un error de conexión o tiempo de espera. ' +
        'Antes de pulsar Guardar otra vez, revisa la lista de órdenes para evitar duplicados.');
      return;
    }

    // Nunca inventamos el folio a partir del máximo observado, ni del ID interno.
    let folio = folioDeRespuesta(respuesta);
    if (!folio) {
      const id = idDeRespuesta(respuesta);
      if (id) {
        try { folio = await buscarFolioPorId(axios, id); }
        catch (error) { console.warn('No se pudo consultar el folio asignado:', error.message); }
      }
    }
    if (!folio) {
      // POST ya respondió: NO repetirlo. Se conservan evidencias con un
      // identificador temporal para poder recuperarlas cuando mejore la API.
      try {
        await guardarOrdenPendiente(armarOrdenLocal(''), idDeRespuesta(respuesta));
      } catch (err) {
        console.warn('No se pudieron conservar las evidencias pendientes:', err.message);
      }
      setGuardada(true);
      setOcupado(false);
      Alert.alert('Orden enviada, folio pendiente',
        'El servidor respondió, pero no devolvió el folio asignado. ' +
        'No repitas el envío. Comprueba la orden en el listado/pgAdmin. ' +
        'Es necesario que la API devuelva id y folio_orden para emitir su PDF.');
      return;
    }

    try {
      const numero = String(folio);
      setForm((anterior) => ({ ...anterior, folio_orden: numero }));
      await guardarOrdenLocal(armarOrdenLocal(numero));
      setGuardada(true);
      Alert.alert('Orden guardada',
        `Folio asignado automáticamente: ${numero}. Ya puedes generar y compartir el PDF. ` +
        'Las firmas y fotografías aún se conservan solo en este dispositivo.');
    } catch (error) {
      // La API ya guardó la orden; no debemos permitir un segundo POST.
      setGuardada(true);
      Alert.alert('Guardado parcial',
        `El servidor asignó el folio ${folio}, pero falló el registro local de evidencias: ` +
        error.message + '. NO vuelvas a enviar la orden.');
    } finally {
      setOcupado(false);
    }
  };
  const compartir = async () => {
    if (!guardada || ocupado || !form.folio_orden) return;
    setOcupado(true);
    try {
      await compartirPdfOrden(armarOrdenLocal());
    } catch (error) {
      Alert.alert('No se pudo compartir el PDF', error.message);
    } finally {
      setOcupado(false);
    }
  };

  const renderInput = (titulo, campo, props = {}) => (
    <View style={styles.campo} key={campo}>
      <Text style={styles.etiqueta}>{titulo}</Text>
      <TextInput
        style={[styles.input, props.multiline && styles.multiline]}
        placeholder={titulo}
        value={form[campo]}
        onChangeText={(texto) => handleChange(campo, texto)}
        editable={!guardada && !ocupado}
        placeholderTextColor="#94a3b8"
        {...props}
      />
    </View>
  );

  const renderFotos = (titulo, etapa, fotos, setFotos) => (
    <View style={styles.bloqueFotos}>
      <Text style={styles.etiqueta}>{titulo} ({fotos.length}/{MIN_FOTOS} mínimo)</Text>
      <View style={styles.fotosGrid}>
        {fotos.map((uri, i) => (
          <View style={styles.fotoItem} key={uri}>
            <Image source={{ uri }} style={styles.miniFoto} />
            {!guardada && <TouchableOpacity
              style={styles.borrarFoto}
              disabled={ocupado}
              onPress={() => setFotos((arr) => arr.filter((x) => x !== uri))}
            ><Text style={styles.borrarTexto}>✕</Text></TouchableOpacity>}
            <Text style={styles.contadorFoto}>{i + 1}</Text>
          </View>
        ))}
      </View>
      {!guardada && <View style={styles.filaBotones}>
        <TouchableOpacity style={styles.secundario} onPress={() => agregarFoto(etapa, true)} disabled={ocupado}>
          <Text style={styles.secundarioTexto}>📷 Tomar foto</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secundario} onPress={() => agregarFoto(etapa, false)} disabled={ocupado}>
          <Text style={styles.secundarioTexto}>Galería</Text>
        </TouchableOpacity>
      </View>}
    </View>
  );

  const renderFirma = (titulo, tipo, uri) => (
    <View style={styles.bloqueFirma}>
      <Text style={styles.etiqueta}>{titulo}</Text>
      {uri ? <Image source={{ uri }} style={styles.imagenFirma} resizeMode="contain" />
        : <Text style={styles.sinFirma}>Firma pendiente</Text>}
      {!guardada && <TouchableOpacity style={styles.secundario}
        onPress={() => setFirmaVisible(tipo)} disabled={ocupado}>
        <Text style={styles.secundarioTexto}>{uri ? 'Volver a firmar' : 'Firmar en pantalla'}</Text>
      </TouchableOpacity>}
    </View>
  );

  return (
    <View style={styles.pantalla}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contenido}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Empresa que realiza el servicio</Text>
        {EMPRESAS.map((empresa) => (
          <TouchableOpacity key={empresa.id}
            disabled={guardada || ocupado}
            style={[styles.opcionEmpresa, empresaId === empresa.id && styles.opcionEmpresaActiva]}
            onPress={() => seleccionarEmpresa(empresa.id)}>
            <Text style={styles.empresaTexto}>{empresaId === empresa.id ? '◉' : '○'}  {empresa.nombre}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.logoBox}>
          {logo
            ? <Image source={typeof logo === 'number' ? logo : { uri: logo }} style={styles.logo} resizeMode="contain" />
            : <Text style={styles.aviso}>Logo pendiente: edita src/services/api.js y copia el PNG en assets/logos/</Text>}
        </View>
        <Text style={styles.sectionTitle}>Contacto de la empresa (pie del PDF)</Text>
        <Text style={styles.aviso}>Estos datos se editan manualmente en src/services/api.js y se incluyen en el APK.</Text>
        {[
          ['Dirección de la empresa', 'direccion'],
          ['Teléfono de la empresa', 'telefono'],
          ['Email de la empresa', 'email']
        ].map(([titulo, campo]) => (
          <View style={styles.campo} key={`contacto-${campo}`}>
            <Text style={styles.etiqueta}>{titulo}</Text>
            <Text>{contactoEmpresa[campo] || 'Pendiente de configurar'}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Datos generales</Text>
        <View style={styles.dosColumnas}>
          <View style={styles.columna}>
            <Text style={styles.etiqueta}>No. de folio</Text>
            <View style={styles.controlFolio}>
              <Text style={styles.inputFolioTexto}>{form.folio_orden || 'Automático al guardar'}</Text>
            </View>
          </View>
          <View style={styles.columna}>
            <Text style={styles.etiqueta}>Motivo de la visita</Text>
            <TouchableOpacity style={styles.dropdown} disabled={guardada || ocupado}
              onPress={() => setMotivosVisible(true)}>
              <Text style={styles.dropdownText} numberOfLines={1}>{form.motivo_servicio}</Text>
              <Text>⌄</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Unidad médica</Text>
        {renderInput('Nombre de la unidad médica *', 'nombre_unidad_medica')}
        {renderInput('Dirección', 'direccion')}
        {renderInput('Ubicación / Área', 'ubicacion')}
        {renderInput('Contacto', 'contacto')}
        {renderInput('No. de contrato / Programa', 'no_contrato')}
        {renderInput('Teléfono unidad', 'tel_unidad', { keyboardType: 'phone-pad' })}
        {renderInput('Teléfono responsable', 'tel_responsable', { keyboardType: 'phone-pad' })}
        {renderInput('Tiempo de garantía', 'tiempo_garantia')}

        <Text style={styles.sectionTitle}>Información del equipo</Text>
        {renderInput('Equipo *', 'equipo')}
        {renderInput('Marca y Modelo', 'marca_modelo')}
        {renderInput('N/S', 'serie')}
        {renderInput('Inventario', 'inventario')}
        {renderInput('Reporte', 'reporte', { multiline: true, textAlignVertical: 'top' })}

        <Text style={styles.sectionTitle}>Observaciones y recomendaciones</Text>
        {renderInput('Observaciones', 'observaciones', { multiline: true, textAlignVertical: 'top' })}
        {renderInput('Recomendaciones', 'recomendaciones', { multiline: true, textAlignVertical: 'top' })}
        {renderInput('Material y refacciones utilizadas', 'material_refacciones', { multiline: true, textAlignVertical: 'top' })}
        <View style={styles.campo}>
          <Text style={styles.etiqueta}>¿Se realizaron pruebas eléctricas? *</Text>
          <View style={styles.filaBotones}>
            {['Sí', 'No'].map((opcion) => (
              <TouchableOpacity
                key={opcion}
                accessibilityRole="radio"
                accessibilityState={{ selected: form.pruebas_electricas === opcion }}
                style={[styles.opcionPrueba, form.pruebas_electricas === opcion && styles.opcionPruebaActiva]}
                disabled={ocupado || guardada}
                onPress={() => handleChange('pruebas_electricas', opcion)}>
                <Text style={styles.opcionPruebaTexto}>{form.pruebas_electricas === opcion ? '◉' : '○'}  {opcion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {renderInput('Simulador (resultados obtenidos)', 'simulador', { multiline: true, textAlignVertical: 'top' })}

        <Text style={styles.sectionTitle}>Evidencia fotográfica (mínimo 6)</Text>
        <Text style={styles.aviso}>Se requieren 3 fotografías de ANTES y 3 de DESPUÉS como mínimo. Puedes agregar más.</Text>
        {renderFotos('ANTES del servicio', 'antes', fotosAntes, setFotosAntes)}
        {renderFotos('DESPUÉS del servicio', 'despues', fotosDespues, setFotosDespues)}

        <Text style={styles.sectionTitle}>Responsables y firmas</Text>
        {renderInput('Nombre del técnico *', 'tecnico_servicio')}
        {renderFirma('Firma del técnico *', 'tecnico', firmaTecnico)}
        {renderInput('Nombre del responsable de la unidad *', 'responsable_unidad')}
        {renderFirma('Firma del responsable *', 'responsable', firmaResponsable)}

        <View style={styles.nota}>
          <Text style={styles.notaTexto}>IMPORTANTE: los folios oficiales se asignan por PostgreSQL al guardar. La API antigua recibe los campos habituales. Reporte, material y refacciones, pruebas eléctricas, simulador y los datos empresariales se guardan SOLO en este teléfono, al igual que fotos y firmas. Recomendaciones se envía al campo antiguo de mantenimiento correctivo; Marca y Modelo se envía al campo antiguo de marca. Falta adaptar el backend para sincronizarlos correctamente.</Text>
        </View>
        {ocupado && <ActivityIndicator size="large" color="#2563a6" style={{ margin: 12 }} />}
        {!guardada ? (
          <TouchableOpacity style={[styles.botonPrincipal, ocupado && styles.deshabilitado]}
            onPress={handleSubmit} disabled={ocupado}>
            <Text style={styles.botonPrincipalTexto}>Guardar orden</Text>
          </TouchableOpacity>
        ) : (
          <>
            {form.folio_orden ? (
              <>
                <Text style={styles.exito}>✓ Orden #{form.folio_orden} guardada. Lista para entregar copia.</Text>
                <TouchableOpacity style={styles.botonPrincipal} onPress={compartir} disabled={ocupado}>
                  <Text style={styles.botonPrincipalTexto}>Compartir copia PDF con cliente</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.aviso}>Orden enviada, pero sin folio confirmado por la API. No se generará un PDF con número inventado. Consulta el registro en pgAdmin.</Text>
            )}
            <TouchableOpacity style={styles.secundario} onPress={() => navigation.goBack()}>
              <Text style={styles.secundarioTexto}>Volver al listado</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal transparent visible={motivosVisible} animationType="fade"
        onRequestClose={() => setMotivosVisible(false)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalLista}>
            <Text style={styles.modalTitulo}>Motivo de la visita</Text>
            {MOTIVOS.map((motivo) => (
              <TouchableOpacity key={motivo} style={styles.motivoOpcion} onPress={() => {
                handleChange('motivo_servicio', motivo);
                setMotivosVisible(false);
              }}><Text style={styles.motivoTexto}>{motivo}</Text></TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelar} onPress={() => setMotivosVisible(false)}>
              <Text style={styles.secundarioTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(firmaVisible)} animationType="slide"
        onRequestClose={() => setFirmaVisible(null)}>
        <View style={styles.modalFirma}>
          <Text style={styles.modalTitulo}>
            {firmaVisible === 'tecnico' ? 'Firma del técnico' : 'Firma del responsable'}
          </Text>
          <Text style={styles.aviso}>Firma con el dedo dentro del recuadro.</Text>
          <View style={styles.canvasBox}>
            <SignatureCanvas
              ref={firmaRef}
              onOK={confirmarFirma}
              onEmpty={() => Alert.alert('Firma vacía', 'Dibuja la firma antes de guardarla.')}
              descriptionText="Firma aquí"
              autoClear={false}
              imageType="image/png"
              webStyle={ESTILO_FIRMA}
              backgroundColor="#ffffff"
              penColor="#142b4e"
            />
          </View>
          <View style={styles.filaBotones}>
            <TouchableOpacity style={styles.secundario} onPress={() => firmaRef.current?.clearSignature()} disabled={ocupado}>
              <Text style={styles.secundarioTexto}>Limpiar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secundario} onPress={() => setFirmaVisible(null)} disabled={ocupado}>
              <Text style={styles.secundarioTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.botonPrincipal} disabled={ocupado}
            onPress={() => firmaRef.current?.readSignature()}>
            <Text style={styles.botonPrincipalTexto}>Guardar firma</Text>
          </TouchableOpacity>
          {ocupado && <ActivityIndicator />}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1 },
  contenido: { padding: 16, paddingBottom: 42 },
  sectionTitle: { fontSize: 17, color: '#1d4f84', fontWeight: '800', marginTop: 19, marginBottom: 12 },
  campo: { marginBottom: 10 },
  etiqueta: { fontSize: 13, fontWeight: '700', color: '#253349', marginBottom: 6 },
  input: { minHeight: 45, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', padding: 10, borderRadius: 8, color: '#172b4d' },
  multiline: { height: 94 },
  dosColumnas: { flexDirection: 'row', gap: 12 },
  columna: { flex: 1 },
  controlFolio: { flexDirection: 'row', alignItems: 'stretch', borderColor: '#a1c7ff', borderWidth: 1, borderRadius: 8, backgroundColor: '#fff', minHeight: 47 },
  inputFolio: { flex: 1, paddingHorizontal: 10, color: '#18283c', minWidth: 0 },
  inputFolioTexto: { flex: 1, paddingHorizontal: 10, paddingVertical: 12, color: '#18283c', fontSize: 12 },
  flechas: { borderLeftWidth: 1, borderColor: '#cbd5e1', width: 34 },
  flecha: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flechaTexto: { fontSize: 10, color: '#334155' },
  dropdown: { minHeight: 47, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  dropdownText: { color: '#192a43', fontSize: 13, flexShrink: 1 },
  opcionEmpresa: { padding: 11, marginBottom: 7, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  opcionEmpresaActiva: { borderColor: '#2563a6', backgroundColor: '#e8f2ff' },
  empresaTexto: { color: '#142c4a', fontSize: 14 },
  logoBox: { padding: 12, backgroundColor: '#fff', borderRadius: 8, borderColor: '#e2e8f0', borderWidth: 1, alignItems: 'center', gap: 10, marginTop: 7 },
  logo: { width: 210, height: 85 },
  botonPerfil: { borderRadius: 8, padding: 12, backgroundColor: '#e3eefb', alignItems: 'center', marginTop: 4 },
  botonPerfilTexto: { color: '#1e4e81', fontWeight: '700' },
  opcionPrueba: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#bac9d9', borderRadius: 8, padding: 13, alignItems: 'center' },
  opcionPruebaActiva: { borderColor: '#2563a6', backgroundColor: '#e8f2ff' },
  opcionPruebaTexto: { color: '#152c46', fontWeight: '700' },
  aviso: { color: '#64748b', fontSize: 12, lineHeight: 19, marginBottom: 6 },
  secundario: { borderWidth: 1, borderColor: '#2563a6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', flex: 1 },
  secundarioTexto: { color: '#20548a', fontWeight: '700', textAlign: 'center' },
  filaBotones: { flexDirection: 'row', gap: 10, marginTop: 9 },
  bloqueFotos: { padding: 12, borderWidth: 1, borderColor: '#d8e3ef', backgroundColor: '#fff', borderRadius: 10, marginTop: 12 },
  fotosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  fotoItem: { width: 92, position: 'relative' },
  miniFoto: { width: 92, height: 92, borderRadius: 6, backgroundColor: '#f1f5f9' },
  borrarFoto: { position: 'absolute', right: 0, top: 0, backgroundColor: '#b91c1c', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  borrarTexto: { color: '#fff', fontWeight: 'bold' },
  contadorFoto: { textAlign: 'center', color: '#64748b', fontSize: 11 },
  bloqueFirma: { backgroundColor: '#fff', padding: 12, marginBottom: 12, borderRadius: 10, borderWidth: 1, borderColor: '#d8e3ef', alignItems: 'stretch' },
  imagenFirma: { height: 110, width: '100%', backgroundColor: '#fff' },
  sinFirma: { height: 65, textAlign: 'center', textAlignVertical: 'center', color: '#64748b' },
  nota: { padding: 12, marginVertical: 16, borderRadius: 8, backgroundColor: '#f1f5f9' },
  notaTexto: { color: '#48586d', fontSize: 12, lineHeight: 17 },
  botonPrincipal: { backgroundColor: '#237448', minHeight: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 9, marginVertical: 10, padding: 12 },
  botonPrincipalTexto: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  deshabilitado: { opacity: 0.5 },
  exito: { color: '#247143', fontWeight: '700', marginVertical: 7 },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'center', padding: 24 },
  modalLista: { backgroundColor: '#fff', padding: 18, borderRadius: 12 },
  modalTitulo: { fontSize: 18, fontWeight: '800', color: '#1c4b80', marginBottom: 10 },
  motivoOpcion: { padding: 14, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  motivoTexto: { color: '#172638', fontSize: 15 },
  cancelar: { alignItems: 'center', padding: 12 },
  modalFirma: { flex: 1, backgroundColor: '#fff', padding: 16, paddingTop: 50 },
  canvasBox: { height: 315, width: '100%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#d8e3ef', borderRadius: 8, overflow: 'hidden', marginTop: 15 }
});
