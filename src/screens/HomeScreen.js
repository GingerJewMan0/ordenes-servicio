import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text,
  TouchableOpacity, View
} from 'react-native';
import axios from 'axios';
import { API_URL } from '../services/api';
import { reconciliarOrdenesPendientes } from '../services/ordenesLocales';

export default function HomeScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState('');

  const fetchOrders = useCallback(async (silencioso = false) => {
    if (silencioso) setActualizando(true);
    else setLoading(true);
    try {
      const respuesta = await axios.get(API_URL, { timeout: 30000 });
      const datos = respuesta.data;
      const items = Array.isArray(datos) ? datos
        : Array.isArray(datos?.ordenes) ? datos.ordenes
        : Array.isArray(datos?.data) ? datos.data : [];
      try { await reconciliarOrdenesPendientes(items); }
      catch (error) { console.warn('No se pudieron recuperar evidencias pendientes:', error.message); }
      setOrders(items);
      setErrorMensaje('');
    } catch (error) {
      console.warn('No se pudieron cargar órdenes:', error.message);
      setErrorMensaje('Sin conexión al servidor o API no disponible.');
    } finally {
      setLoading(false);
      setActualizando(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const cancelar = navigation.addListener('focus', () => fetchOrders(true));
    return cancelar;
  }, [navigation, fetchOrders]);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button}
        onPress={() => navigation.navigate('CreateOrder')}>
        <Text style={styles.buttonText}>+ Nueva orden de servicio</Text>
      </TouchableOpacity>
      {!!errorMensaje && <Text style={styles.error}>{errorMensaje}</Text>}
      {loading ? <ActivityIndicator size="large" color="#2563a6" style={{ marginTop: 20 }} />
        : <FlatList
          data={orders}
          keyExtractor={(item, i) => String(item.id ?? item._id ?? `folio-${item.folio_orden}-${i}`)}
          refreshControl={<RefreshControl refreshing={actualizando} onRefresh={() => fetchOrders(true)} />}
          ListEmptyComponent={<Text style={styles.vacio}>No hay órdenes disponibles. Desliza hacia abajo para actualizar.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('OrderDetail', { orden: item })}>
              <Text style={styles.folio}>Folio: #{item.folio_orden ?? '—'}</Text>
              <Text style={styles.text}>Unidad: {item.nombre_unidad_medica || '—'}</Text>
              <Text style={styles.text}>Equipo: {item.equipo || '—'} ({item.marca || 'Sin marca'})</Text>
              <Text style={styles.text}>Motivo: {item.motivo_servicio || '—'}</Text>
              <Text style={styles.status}>Estado: {item.estado_orden || 'Sin definir'}</Text>
              <Text style={styles.detalle}>Toca para ver y compartir copia PDF</Text>
            </TouchableOpacity>
          )}
        />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f7fb' },
  button: { backgroundColor: '#2b6cb0', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 15 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 8, marginBottom: 10, elevation: 2 },
  folio: { fontSize: 16, fontWeight: 'bold', color: '#2b6cb0', marginBottom: 4 },
  text: { fontSize: 14, color: '#333', marginBottom: 3 },
  status: { fontSize: 12, fontWeight: 'bold', color: 'green', marginTop: 6 },
  detalle: { fontSize: 12, color: '#2563a6', marginTop: 10, fontWeight: '700' },
  error: { color: '#a42525', marginBottom: 12 },
  vacio: { color: '#64748b', textAlign: 'center', marginTop: 20 }
});
