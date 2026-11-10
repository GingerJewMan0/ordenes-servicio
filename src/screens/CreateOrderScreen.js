import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, ScrollView, TouchableOpacity, Alert } from 'react-native';
import axios from 'axios';

const API_URL = 'https://ordenes-servicio-jdej.onrender.com/api/ordenes';

export default function CreateOrderScreen({ route, navigation }) {
  const { refresh } = route.params || {};

  const [form, setForm] = useState({
    folio_orden: '',
    motivo_servicio: 'Mtto. Preventivo',
    nombre_unidad_medica: '',
    direccion: '',
    ubicacion: '',
    contacto: '',
    no_contrato: '',
    tel_unidad: '',
    tel_responsable: '',
    tiempo_garantia: '',
    equipo: '',
    marca: '',
    modelo: '',
    serie: '',
    inventario: '',
    observaciones: '',
    observaciones_mtto_correctivo: '',
    tecnico_servicio: '',
    responsable_unidad: ''
  });

  const handleChange = (name, value) => {
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = async () => {
    if (!form.folio_orden || !form.nombre_unidad_medica || !form.equipo) {
      Alert.alert('Error', 'Por favor llena los campos obligatorios (Folio, Unidad y Equipo)');
      return;
    }

    try {
      await axios.post(API_URL, {
        ...form,
        folio_orden: parseInt(form.folio_orden)
      });
      Alert.alert('Éxito', 'Orden de servicio guardada correctamente en la base de datos');
      if (refresh) refresh();
      navigation.goBack();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo guardar la orden de servicio en el servidor');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>Datos Generales</Text>
      <TextInput placeholder="Folio de Orden (ej. 1002)" keyboardType="numeric" style={styles.input} value={form.folio_orden} onChangeText={(val) => handleChange('folio_orden', val)} />
      <TextInput placeholder="Motivo de Servicio (ej. Mtto. Preventivo)" style={styles.input} value={form.motivo_servicio} onChangeText={(val) => handleChange('motivo_servicio', val)} />

      <Text style={styles.sectionTitle}>Unidad Médica</Text>
      <TextInput placeholder="Nombre de la Unidad Médica" style={styles.input} value={form.nombre_unidad_medica} onChangeText={(val) => handleChange('nombre_unidad_medica', val)} />
      <TextInput placeholder="Dirección" style={styles.input} value={form.direccion} onChangeText={(val) => handleChange('direccion', val)} />
      <TextInput placeholder="Ubicación / Área" style={styles.input} value={form.ubicacion} onChangeText={(val) => handleChange('ubicacion', val)} />
      <TextInput placeholder="Contacto" style={styles.input} value={form.contacto} onChangeText={(val) => handleChange('contacto', val)} />
      <TextInput placeholder="No. de Contrato" style={styles.input} value={form.no_contrato} onChangeText={(val) => handleChange('no_contrato', val)} />
      <TextInput placeholder="Teléfono Unidad" style={styles.input} value={form.tel_unidad} onChangeText={(val) => handleChange('tel_unidad', val)} />
      <TextInput placeholder="Teléfono Responsable" style={styles.input} value={form.tel_responsable} onChangeText={(val) => handleChange('tel_responsable', val)} />
      <TextInput placeholder="Tiempo de Garantía" style={styles.input} value={form.tiempo_garantia} onChangeText={(val) => handleChange('tiempo_garantia', val)} />

      <Text style={styles.sectionTitle}>Información del Equipo</Text>
      <TextInput placeholder="Equipo" style={styles.input} value={form.equipo} onChangeText={(val) => handleChange('equipo', val)} />
      <TextInput placeholder="Marca" style={styles.input} value={form.marca} onChangeText={(val) => handleChange('marca', val)} />
      <TextInput placeholder="Modelo" style={styles.input} value={form.modelo} onChangeText={(val) => handleChange('modelo', val)} />
      <TextInput placeholder="No. de Serie" style={styles.input} value={form.serie} onChangeText={(val) => handleChange('serie', val)} />
      <TextInput placeholder="Inventario" style={styles.input} value={form.inventario} onChangeText={(val) => handleChange('inventario', val)} />

      <Text style={styles.sectionTitle}>Observaciones y Firmas</Text>
      <TextInput placeholder="Observaciones generales" multiline style={[styles.input, { height: 80 }]} value={form.observaciones} onChangeText={(val) => handleChange('observaciones', val)} />
      <TextInput placeholder="Observaciones de Mtto. Correctivo" multiline style={[styles.input, { height: 80 }]} value={form.observaciones_mtto_correctivo} onChangeText={(val) => handleChange('observaciones_mtto_correctivo', val)} />
      <TextInput placeholder="Técnico de Servicio" style={styles.input} value={form.tecnico_servicio} onChangeText={(val) => handleChange('tecnico_servicio', val)} />
      <TextInput placeholder="Responsable de la Unidad" style={styles.input} value={form.responsable_unidad} onChangeText={(val) => handleChange('responsable_unidad', val)} />

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
        <Text style={styles.submitButtonText}>Guardar Orden</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#2b6cb0', marginTop: 15, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#cbd5e0', borderRadius: 6, padding: 10, marginBottom: 10, backgroundColor: '#fff' },
  submitButton: { backgroundColor: '#2f855a', padding: 15, borderRadius: 8, alignItems: 'center', marginVertical: 20 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});