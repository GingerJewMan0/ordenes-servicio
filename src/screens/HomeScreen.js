import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import axios from 'axios';

// Reemplaza con la URL de tu API web service desplegada en Render
const API_URL = 'https://tu-backend-en-render.onrender.com/api/ordenes';

export default function HomeScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    try {
      const response = await axios.get(API_URL);
      setOrders(response.data);
    } catch (error) {
      console.error('Error al cargar órdenes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.button} 
        onPress={() => navigation.navigate('CreateOrder', { refresh: fetchOrders })}
      >
        <Text style={styles.buttonText}>+ Nueva Orden de Servicio</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.folio}>Folio: #{item.folio_orden}</Text>
              <Text style={styles.text}>Unidad: {item.nombre_unidad_medica}</Text>
              <Text style={styles.text}>Equipo: {item.equipo} ({item.marca})</Text>
              <Text style={styles.text}>Motivo: {item.motivo_servicio}</Text>
              <Text style={styles.status}>Estado: {item.estado_orden}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f5f5f5' },
  button: { backgroundColor: '#2b6cb0', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 15 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 8, marginBottom: 10, elevation: 2 },
  folio: { fontSize: 16, fontWeight: 'bold', color: '#2b6cb0', marginBottom: 4 },
  text: { fontSize: 14, color: '#333', marginBottom: 2 },
  status: { fontSize: 12, fontWeight: 'bold', color: 'green', marginTop: 6 }
});