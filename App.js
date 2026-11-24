import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Modal, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/screens/HomeScreen';
import CreateOrderScreen from './src/screens/CreateOrderScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import EditOrderScreen from './src/screens/EditOrderScreen';
import ViaticosScreen from './src/screens/ViaticosScreen';
import LoginScreen from './src/screens/LoginScreen';
import AdminUsuariosScreen from './src/screens/AdminUsuariosScreen';
import ReportesHospitalariosScreen from './src/screens/ReportesHospitalariosScreen';
import MisReportesScreen from './src/screens/MisReportesScreen';
import {
  configurarAxiosConSesion,
  establecerManejadorSesionCaducada,
  restaurarSesion,
  cerrarSesion,
  sincronizarCierrePendiente
} from './src/services/authSesion';
import {
  registrarNotificacionesTecnico,
  desregistrarNotificacionesTecnico
} from './src/services/pushTecnicos';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';

// Conservamos el Stack original para no alterar las pantallas de órdenes.
// El menú lateral es propio de React Native; no exige bibliotecas nuevas.
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

export default function App() {
  const [menuVisible, setMenuVisible] = useState(false);
  const [pantallaActiva, setPantallaActiva] = useState('Home');
  const [usuarioActual, setUsuarioActual] = useState(null);
  const [verificando, setVerificando] = useState(true);
  const [errorInicio, setErrorInicio] = useState('');

  // Controlar la navegación desde las notificaciones push.
  const ultimaRespuesta = Notifications.useLastNotificationResponse();
  const [navegacionLista, setNavegacionLista] = useState(0);

  const cargarSesion = async () => {
    setVerificando(true);
    setErrorInicio('');
    try { setUsuarioActual(await restaurarSesion()); }
    catch (e) { setErrorInicio(e?.message || 'No se pudo recuperar la sesión.'); }
    finally { setVerificando(false); }
  };
  useEffect(() => {
    configurarAxiosConSesion();
    establecerManejadorSesionCaducada(() => {
      setUsuarioActual(null);
      setMenuVisible(false);
    });
    cargarSesion();
    return () => establecerManejadorSesionCaducada(null);
  }, []);
    // Sincronizar cierres de sesión pendientes al abrir o reactivar la app.
  useEffect(() => {
    let sincronizando = false;

    const intentarSincronizar = async () => {
      if (sincronizando) return;

      sincronizando = true;

      try {
        await sincronizarCierrePendiente();
      } catch (error) {
        console.warn(
          '[Auth] Error de sincronización:',
          error?.message
        );
      } finally {
        sincronizando = false;
      }
    };

    // Intentar al abrir la aplicación.
    intentarSincronizar();

    // Volver a intentar cuando Android reactive la aplicación.
    const suscripcion = AppState.addEventListener(
      'change',
      (estado) => {
        if (estado === 'active') {
          intentarSincronizar();
        }
      }
    );

        // Detectar cuando Android recupera internet.
    const suscripcionRed = NetInfo.addEventListener((estado) => {
      if (
        estado.isConnected === true &&
        estado.isInternetReachable === true
      ) {
        intentarSincronizar();
      }
    });

    return () => {
      suscripcion.remove();
      suscripcionRed();
    };
  }, []);
  // Registrar notificaciones push únicamente para técnicos.
  useEffect(() => {
    if (!['tecnico', 'admin'].includes(usuarioActual?.rol)) return;

    let cancelado = false;

    registrarNotificacionesTecnico(() => cancelado)
      .then((resultado) => {
        if (!cancelado && !resultado?.ok) {
          console.warn(
            '[Push] Registro no completado:',
            resultado?.motivo || 'Sin detalles'
          );
        }
      })
      .catch((error) => {
        if (!cancelado) {
          console.warn(
            '[Push] Error al registrar dispositivo:',
            error?.message || 'Error desconocido'
          );
        }
      });

    return () => {
      cancelado = true;
    };
    }, [usuarioActual?.id, usuarioActual?.rol]);
  // Procesar la notificación cuando la navegación esté preparada.
  useEffect(() => {
    const datos = ultimaRespuesta?.notification?.request?.content?.data;

    if (navegacionLista === 0 || !navigationRef.isReady()) {
      return;
    }

    // Técnicos: abrir sus reportes asignados.
    if (
      usuarioActual?.rol === 'tecnico' &&
      datos?.tipo === 'reporte_asignado'
    ) {
      navigationRef.navigate('MisReportes');
    }

    // Administradores: abrir los reportes hospitalarios.
    else if (
      usuarioActual?.rol === 'admin' &&
      datos?.tipo === 'reporte_hospitalario_nuevo'
    ) {
      navigationRef.navigate('ReportesHospitalarios');
    }

  }, [ultimaRespuesta, usuarioActual?.rol, navegacionLista]);

const salir = async () => {
  setMenuVisible(false);

  // Retirar las notificaciones push antes de cerrar sesión.
  if (usuarioActual?.rol === 'tecnico' || usuarioActual?.rol === 'admin') {
    try {
      const retirado = await desregistrarNotificacionesTecnico();

      if (!retirado) {
        console.warn(
          '[Push] No se pudo retirar el dispositivo del servidor.'
        );
      }
    } catch (error) {
      console.warn(
        '[Push] Error al retirar notificaciones:',
        error?.message || 'Error desconocido'
      );
    }
  }

  try {
    const revocada = await cerrarSesion();
    setUsuarioActual(null);

    if (!revocada) {
      Alert.alert(
        'Sesión cerrada en este dispositivo',
        'No se pudo contactar al servidor. El cierre pendiente se sincronizará cuando vuelva la conexión.'
      );
    }
  } catch (error) {
    Alert.alert(
      'No se pudo cerrar sesión de forma segura',
      error?.message || 'Intenta nuevamente.'
    );
  }
};
  const navegar = (pantalla) => {
    setMenuVisible(false);
    if (navigationRef.isReady()) {
      navigationRef.navigate(pantalla);
    }
  };

  const botonMenu = () => (
    <TouchableOpacity
      onPress={() => setMenuVisible(true)}
      accessibilityRole="button"
      accessibilityLabel="Abrir menú lateral"
      hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
      style={styles.botonMenu}
    >
      <Text style={styles.iconoMenu}>☰</Text>
    </TouchableOpacity>
  );

  if (verificando) return <SafeAreaView style={styles.espera}><ActivityIndicator size="large" color="#15558e" /><Text>Verificando sesión…</Text></SafeAreaView>;
  if (errorInicio) return <SafeAreaView style={styles.espera}>
    <Text style={styles.errorInicio}>{errorInicio}</Text>
    <TouchableOpacity onPress={cargarSesion} style={styles.reintento}><Text style={styles.reintentoTexto}>Reintentar</Text></TouchableOpacity>
  </SafeAreaView>;
  if (!usuarioActual) return <LoginScreen onLogin={setUsuarioActual} />;

  return (
    <>
      <NavigationContainer
  ref={navigationRef}
  onReady={() => {
    const ruta = navigationRef.getCurrentRoute();
    if (ruta?.name) setPantallaActiva(ruta.name);
    setNavegacionLista(n => n + 1);
  }}
  onStateChange={() => {
    const ruta = navigationRef.getCurrentRoute();
    if (ruta?.name) setPantallaActiva(ruta.name);
  }}
>
        <Stack.Navigator initialRouteName="Home" screenOptions={{
          headerTintColor: '#154b78',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#f5f7fb' }
        }}>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Órdenes de Servicio', headerLeft: botonMenu }}
          />
          <Stack.Screen
            name="CreateOrder"
            component={CreateOrderScreen}
            options={{ title: 'Nueva Orden de Servicio' }}
          />
          <Stack.Screen
            name="OrderDetail"
            options={{ title: 'Detalle de orden' }}
          >
            {(props) => <OrderDetailScreen {...props} rolUsuario={usuarioActual?.rol} />}
          </Stack.Screen>
          <Stack.Screen
            name="EditOrder"
            component={EditOrderScreen}
            options={{ title: 'Editar orden' }}
          />
          <Stack.Screen
            name="Viaticos"
            component={ViaticosScreen}
            options={{ title: 'Generador de Viáticos', headerLeft: botonMenu }}
          />
          {usuarioActual?.rol === 'admin' && <Stack.Screen
            name="AdministracionUsuarios"
            component={AdminUsuariosScreen}
            options={{ title: 'Administración de usuarios', headerLeft: botonMenu }}
          />}
          {usuarioActual?.rol === 'tecnico' && <Stack.Screen
            name="MisReportes"
            component={MisReportesScreen}
            options={{ title: 'Mis reportes asignados', headerLeft: botonMenu }}
          />}
          {usuarioActual?.rol === 'admin' && <Stack.Screen
            name="ReportesHospitalarios"
            component={ReportesHospitalariosScreen}
            options={{ title: 'Reportes Hospitalarios', headerLeft: botonMenu }}
          />}
        </Stack.Navigator>
      </NavigationContainer>

      <Modal
        visible={menuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setMenuVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.modal}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cerrar menú"
            style={styles.fondo}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />
          <SafeAreaView style={[styles.panel, { paddingTop: (StatusBar.currentHeight || 0) + 18 }]}>
            <View style={styles.cabecera}>
              <Text style={styles.cabeceraTitulo}>Gestión Empresarial</Text>
              <Text style={styles.cabeceraSubtitulo}>Servicios y viáticos · {usuarioActual.usuario} ({usuarioActual.rol})</Text>
            </View>
            <TouchableOpacity
              style={[styles.opcion, pantallaActiva === 'Home' && styles.opcionActiva]}
              onPress={() => navegar('Home')}
              accessibilityRole="button"
            >
              <Text style={styles.opcionEmoji}>📋</Text>
              <Text style={styles.opcionTexto}>Órdenes de Servicio</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.opcion, pantallaActiva === 'Viaticos' && styles.opcionActiva]}
              onPress={() => navegar('Viaticos')}
              accessibilityRole="button"
            >
              <Text style={styles.opcionEmoji}>💼</Text>
              <Text style={styles.opcionTexto}>Generador de Viáticos</Text>
            </TouchableOpacity>
            {usuarioActual?.rol === 'tecnico' && <TouchableOpacity
              style={[styles.opcion, pantallaActiva === 'MisReportes' && styles.opcionActiva]}
              onPress={() => navegar('MisReportes')} accessibilityRole="button"
            ><Text style={styles.opcionEmoji}>🔔</Text><Text style={styles.opcionTexto}>Mis reportes asignados</Text></TouchableOpacity>}
            {usuarioActual?.rol === 'admin' && <TouchableOpacity
              style={[styles.opcion, pantallaActiva === 'ReportesHospitalarios' && styles.opcionActiva]}
              onPress={() => navegar('ReportesHospitalarios')}
              accessibilityRole="button"
            >
              <Text style={styles.opcionEmoji}>🏥</Text>
              <Text style={styles.opcionTexto}>Reportes Hospitalarios</Text>
            </TouchableOpacity>}
            {usuarioActual?.rol === 'admin' && <TouchableOpacity
              style={[styles.opcion, pantallaActiva === 'AdministracionUsuarios' && styles.opcionActiva]}
              onPress={() => navegar('AdministracionUsuarios')}
              accessibilityRole="button"
            >
              <Text style={styles.opcionEmoji}>👥</Text>
              <Text style={styles.opcionTexto}>Administrar usuarios</Text>
            </TouchableOpacity>}
            <TouchableOpacity onPress={salir} accessibilityRole="button" style={styles.cerrarSesion}>
              <Text style={styles.cerrarSesionTexto}>Cerrar sesión</Text>
            </TouchableOpacity>
            <Text style={styles.pieMenu}>Los datos se guardan en las mismas tablas de PostgreSQL.</Text>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  botonMenu: { marginRight: 20, paddingVertical: 6, paddingHorizontal: 3 },
  iconoMenu: { fontSize: 26, color: '#154b78' },
  modal: { flex: 1, flexDirection: 'row' },
  fondo: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.48)' },
  panel: { width: 300, maxWidth: '85%', height: '100%', backgroundColor: '#fff', elevation: 10 },
  cabecera: { backgroundColor: '#15558e', paddingHorizontal: 20, paddingVertical: 22, marginBottom: 14 },
  cabeceraTitulo: { color: '#fff', fontWeight: '800', fontSize: 20 },
  cabeceraSubtitulo: { color: '#d5e8f9', fontSize: 13, marginTop: 6 },
  opcion: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 10, marginBottom: 5, padding: 15, borderRadius: 10 },
  opcionActiva: { backgroundColor: '#e8f3fc' },
  opcionEmoji: { fontSize: 21, marginRight: 12 },
  opcionTexto: { fontSize: 15, fontWeight: '700', color: '#173753', flexShrink: 1 },
  pieMenu: { marginHorizontal: 22, marginTop: 26, color: '#64748b', fontSize: 12, lineHeight: 18 },
  cerrarSesion:{marginHorizontal:18, marginTop:18, padding:14, borderWidth:1, borderColor:'#bacada', borderRadius:8},
  cerrarSesionTexto:{color:'#164b77',textAlign:'center',fontWeight:'700'},
  espera:{flex:1,backgroundColor:'#f5f7fb',justifyContent:'center',alignItems:'center',padding:24,gap:18},
  errorInicio:{fontSize:16,color:'#9d301e',textAlign:'center'},
  reintento:{padding:14,backgroundColor:'#15558e',borderRadius:8},
  reintentoTexto:{color:'#fff',fontWeight:'700'}
});