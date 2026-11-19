import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import {obtenerPerfilSesion} from '../services/authSesion';
import {
  listarUsuarios, crearTecnico, renombrarTecnico, eliminarTecnico,
  cambiarClaveTecnico, mensajeErrorUsuarios
} from '../services/adminUsuariosApi';

const AZUL = '#15558e';

export default function AdminUsuariosScreen() {
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [modal, setModal] = useState(null); // {tipo: crear | editar | clave, cuenta?}
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');

  const esAdmin = obtenerPerfilSesion()?.rol === 'admin';

  const cargar = useCallback(async (silencioso = false) => {
    if (silencioso) setActualizando(true);
    else setCargando(true);
    try {
      setUsuarios(await listarUsuarios());
    } catch (e) {
      Alert.alert('No se pudieron cargar los usuarios', mensajeErrorUsuarios(e));
    } finally {
      setCargando(false);
      setActualizando(false);
    }
  }, []);

  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin, cargar]);

  function abrir(tipo, cuenta = null) {
    if (tipo !== 'crear' && cuenta?.rol !== 'tecnico') return;
    setNombre(tipo === 'editar' ? cuenta.usuario : '');
    setClave('');
    setRepetir('');
    setModal({tipo, cuenta});
  }

  function cerrarModal() {
    if (!ocupado) { setModal(null); setClave(''); setRepetir(''); }
  }

  async function guardar() {
    if (!modal || ocupado) return;
    if (modal.tipo !== 'crear' && modal.cuenta?.rol !== 'tecnico') {
      return Alert.alert('Cuenta protegida', 'Las cuentas administradoras solo pueden gestionarse mediante SQL.');
    }
    const normalizado = nombre.trim().toLowerCase();
    if ((modal.tipo === 'crear' || modal.tipo === 'editar') && !/^[a-z0-9._-]{3,80}$/.test(normalizado)) {
      return Alert.alert('Usuario inválido', 'Utiliza entre 3 y 80 caracteres: letras minúsculas, números, puntos, guiones o guiones bajos.');
    }
    if (modal.tipo === 'crear' || modal.tipo === 'clave') {
      if (clave.length < 12 || clave.length > 128) return Alert.alert('Contraseña inválida', 'Utiliza entre 12 y 128 caracteres.');
      if (clave !== repetir) return Alert.alert('Las contraseñas no coinciden', 'Escribe exactamente la misma contraseña dos veces.');
    }
    setOcupado(true);
    try {
      if (modal.tipo === 'crear') await crearTecnico(normalizado, clave);
      if (modal.tipo === 'editar') await renombrarTecnico(modal.cuenta.id, normalizado);
      if (modal.tipo === 'clave') await cambiarClaveTecnico(modal.cuenta.id, clave);
      const tipo = modal.tipo;
      setModal(null);
      setClave(''); setRepetir('');
      await cargar(true);
      Alert.alert('Operación completada', tipo === 'clave'
        ? 'Contraseña actualizada. Las sesiones anteriores del técnico quedaron cerradas.'
        : tipo === 'crear' ? 'La cuenta de técnico se creó correctamente.' : 'Nombre de usuario actualizado.');
    } catch (e) {
      Alert.alert('No se pudo guardar', mensajeErrorUsuarios(e));
    } finally { setOcupado(false); }
  }

  function confirmarEliminar(cuenta) {
    // Solo cuentas de técnicos. El backend debe verificar nuevamente el rol,
    // el historial y la existencia de sesiones antes de eliminar.
    if (ocupado || !cuenta || cuenta.rol !== 'tecnico') return;
    Alert.alert(
      'Eliminar usuario técnico',
      `¿Eliminar definitivamente la cuenta "${cuenta.usuario}"? No se pueden recuperar sus credenciales. Las órdenes, viáticos y registros de auditoría deben conservarse.`,
      [
        {text: 'Cancelar', style: 'cancel'},
        {text: 'Eliminar usuario', style: 'destructive', onPress: async () => {
          if (ocupado) return;
          setOcupado(true);
          try {
            await eliminarTecnico(cuenta.id);
            await cargar(true);
            Alert.alert('Usuario eliminado', 'Se retiró la cuenta de técnico y se revocó su acceso.');
          } catch (e) {
            Alert.alert('No se pudo eliminar', mensajeErrorUsuarios(e));
          } finally { setOcupado(false); }
        }}
      ]
    );
  }

  if (!esAdmin) return <View style={s.centro}><Text style={s.error}>Esta pantalla está reservada al administrador.</Text></View>;

  return <SafeAreaView style={s.pantalla}>
    <ScrollView contentContainerStyle={s.contenido} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={actualizando} onRefresh={() => cargar(true)} />}>
      <View style={s.encabezado}>
        <Text style={s.titulo}>Administración de usuarios</Text>
        <Text style={s.descripcion}>Crea y elimina técnicos, cambia sus nombres y contraseñas. Las cuentas administradoras solo se modifican mediante SQL.</Text>
        <TouchableOpacity style={s.primario} disabled={ocupado} onPress={() => abrir('crear')} accessibilityRole="button">
          <Text style={s.primarioTexto}>＋ Crear usuario técnico</Text>
        </TouchableOpacity>
      </View>

      <View style={s.resumen}>
        <Text style={s.resumenTexto}>Usuarios: {usuarios.length}</Text>
        <Text style={s.resumenTexto}>Activos: {usuarios.filter(u => u.activo).length}</Text>
        <TouchableOpacity onPress={() => cargar(true)} disabled={actualizando || ocupado} accessibilityRole="button">
          <Text style={s.actualizar}>Actualizar</Text>
        </TouchableOpacity>
      </View>

      {cargando ? <ActivityIndicator style={{marginTop: 36}} size="large" color={AZUL} /> :
      usuarios.length === 0 ? <Text style={s.ayuda}>No se encontraron usuarios.</Text> :
      usuarios.map(cuenta => {
        const tecnico = cuenta.rol === 'tecnico';
        return <View style={s.tarjeta} key={String(cuenta.id)}>
          <View style={s.filaTitulo}>
            <View style={{flex: 1}}>
              <Text style={s.nombre}>{cuenta.usuario}</Text>
              <Text style={s.rol}>{tecnico ? 'Técnico' : 'Administrador'}</Text>
            </View>
            <View style={[s.estado, cuenta.activo ? s.estadoActivo : s.estadoInactivo]}>
              <Text style={[s.estadoTexto, cuenta.activo ? s.estadoTextoActivo : s.estadoTextoInactivo]}>{cuenta.activo ? 'Activo' : 'Inactivo'}</Text>
            </View>
          </View>
          {tecnico ? <View style={s.acciones}>
            <TouchableOpacity style={s.secundario} disabled={ocupado} onPress={() => abrir('editar', cuenta)}><Text style={s.secundarioTexto}>Editar nombre</Text></TouchableOpacity>
            <TouchableOpacity style={s.secundario} disabled={ocupado} onPress={() => abrir('clave', cuenta)}><Text style={s.secundarioTexto}>Contraseña</Text></TouchableOpacity>
            <TouchableOpacity style={[s.secundario, s.botonEliminar]} disabled={ocupado}
              onPress={() => confirmarEliminar(cuenta)} accessibilityRole="button">
              <Text style={s.eliminarTexto}>Eliminar usuario</Text>
            </TouchableOpacity>
          </View> : <Text style={s.ayuda}>La cuenta administradora está protegida contra cambios desde este panel.</Text>}
        </View>;
      })}
      <Text style={s.nota}>Solo se pueden gestionar cuentas de técnicos. El servidor debe impedir cambios en administradores, revocar las sesiones tras eliminar o cambiar contraseña y conservar órdenes, viáticos y auditoría.</Text>
    </ScrollView>

    <Modal animationType="slide" transparent visible={Boolean(modal)} onRequestClose={cerrarModal}>
      <View style={s.fondoModal}>
        <View style={s.modalContenido}>
          <Text style={s.modalTitulo}>{modal?.tipo === 'crear' ? 'Nuevo técnico' : modal?.tipo === 'editar' ? 'Editar nombre de usuario' : 'Cambiar contraseña'}</Text>
          {modal?.tipo === 'clave' ? <Text style={s.ayuda}>Cuenta: {modal?.cuenta?.usuario}</Text> : <>
            <Text style={s.etiqueta}>Usuario</Text>
            <TextInput style={s.entrada} value={nombre} onChangeText={setNombre} editable={!ocupado}
              autoCapitalize="none" autoCorrect={false} maxLength={80} placeholder="ej. tecnico2" />
          </>}
          {modal?.tipo !== 'editar' && <>
            <Text style={s.etiqueta}>Contraseña nueva (mínimo 12 caracteres)</Text>
            <TextInput style={s.entrada} value={clave} onChangeText={setClave} editable={!ocupado}
              secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Nueva contraseña" />
            <Text style={s.etiqueta}>Confirmar contraseña</Text>
            <TextInput style={s.entrada} value={repetir} onChangeText={setRepetir} editable={!ocupado}
              secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Repite la contraseña" />
          </>}
          <View style={s.botonesModal}>
            <TouchableOpacity style={[s.botonModal, s.cancelar]} onPress={cerrarModal} disabled={ocupado}><Text style={s.cancelarTexto}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity style={[s.botonModal, s.guardar]} onPress={guardar} disabled={ocupado}>
              <Text style={s.guardarTexto}>{ocupado ? 'Guardando…' : 'Guardar'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  pantalla: {flex: 1, backgroundColor: '#f5f7fb'},
  contenido: {padding: 16, paddingBottom: 48},
  encabezado: {backgroundColor: AZUL, borderRadius: 15, padding: 20, marginBottom: 16},
  titulo: {fontSize: 21, color: 'white', fontWeight: '800'},
  descripcion: {color: '#e1f2fc', fontSize: 13, lineHeight: 19, marginTop: 9, marginBottom: 16},
  primario: {backgroundColor: 'white', borderRadius: 9, alignItems: 'center', paddingVertical: 13, paddingHorizontal: 10},
  primarioTexto: {color: AZUL, fontWeight: '800'},
  resumen: {flexDirection: 'row', gap: 15, alignItems: 'center', marginBottom: 13, flexWrap: 'wrap'},
  resumenTexto: {fontSize: 13, fontWeight: '700', color: '#334155'},
  actualizar: {color: AZUL, fontWeight: '700', fontSize: 13},
  tarjeta: {backgroundColor: 'white', borderWidth: 1, borderColor: '#e0e8f1', borderRadius: 13, padding: 15, marginBottom: 12},
  filaTitulo: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8},
  nombre: {color: '#173753', fontWeight: '800', fontSize: 16},
  rol: {color: '#64748b', fontSize: 13, marginTop: 3},
  estado: {paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20},
  estadoActivo: {backgroundColor: '#e2f8ee'}, estadoInactivo: {backgroundColor: '#fff0e9'},
  estadoTexto: {fontSize: 12, fontWeight: '700'},
  estadoTextoActivo: {color: '#137647'}, estadoTextoInactivo: {color: '#aa4e28'},
  acciones: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 8},
  secundario: {borderWidth: 1, borderColor: '#b7cadb', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11},
  secundarioTexto: {color: AZUL, fontWeight: '700', fontSize: 12},
  botonEliminar: {borderColor: '#d48d8d'}, eliminarTexto: {color: '#a33336', fontWeight: '800', fontSize: 12},
  ayuda: {fontSize: 12, color: '#64748b', lineHeight: 18, marginTop: 3},
  nota: {fontSize: 12, color: '#64748b', lineHeight: 18, padding: 6, marginTop: 5},
  centro: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  error: {color: '#a33336', textAlign: 'center', fontSize: 15},
  fondoModal: {flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 20},
  modalContenido: {backgroundColor: '#fff', borderRadius: 14, padding: 20},
  modalTitulo: {fontWeight: '800', fontSize: 19, color: '#173753', marginBottom: 15},
  etiqueta: {fontSize: 13, color: '#334155', fontWeight: '700', marginBottom: 5, marginTop: 7},
  entrada: {borderWidth: 1, borderColor: '#b8ccdd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#173753'},
  botonesModal: {flexDirection: 'row', marginTop: 24, gap: 10},
  botonModal: {flex: 1, borderRadius: 9, paddingVertical: 12, alignItems: 'center'},
  cancelar: {backgroundColor: '#edf2f7'}, cancelarTexto: {color: '#334155', fontWeight: '800'},
  guardar: {backgroundColor: AZUL}, guardarTexto: {color: 'white', fontWeight: '800'}
});
