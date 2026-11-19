import React, {useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {iniciarSesion} from '../services/authSesion';

export default function LoginScreen({onLogin}) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const entrar = async () => {
    if (!usuario.trim() || !clave || ocupado) return;
    setOcupado(true);
    setError('');
    try {
      const perfil = await iniciarSesion(usuario, clave);
      setClave('');
      onLogin(perfil);
    } catch (e) {
      const estado = e?.response?.status;
      setError(estado === 401 ? 'Usuario o contraseña incorrectos.'
        : estado === 429 ? 'Demasiados intentos. Intenta más tarde.'
        : e?.response?.data?.error || e?.message || 'No se pudo conectar con el servidor.');
    } finally {setOcupado(false);}
  };
  return (
    <SafeAreaView style={estilos.raiz}>
      <KeyboardAvoidingView style={estilos.centrado} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={estilos.tarjeta}>
          <Text style={estilos.icono}>🛠️</Text>
          <Text style={estilos.titulo}>Gestión de Servicios</Text>
          <Text style={estilos.subtitulo}>Órdenes de servicio y comprobación de viáticos</Text>
          <Text style={estilos.etiqueta}>Usuario</Text>
          <TextInput style={estilos.campo} placeholder="Tu usuario" autoCapitalize="none"
            autoCorrect={false} textContentType="username" value={usuario} onChangeText={setUsuario}
            editable={!ocupado} accessibilityLabel="Usuario" />
          <Text style={estilos.etiqueta}>Contraseña</Text>
          <TextInput style={estilos.campo} placeholder="Tu contraseña" secureTextEntry
            textContentType="password" value={clave} onChangeText={setClave}
            editable={!ocupado} accessibilityLabel="Contraseña" onSubmitEditing={entrar} />
          {!!error && <Text style={estilos.error}>{error}</Text>}
          <TouchableOpacity style={[estilos.boton, ocupado && {opacity: 0.6}]} onPress={entrar} disabled={ocupado} accessibilityRole="button">
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Iniciar sesión</Text>}
          </TouchableOpacity>
          <Text style={estilos.pie}>Acceso exclusivo para personal autorizado.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const estilos = StyleSheet.create({
  raiz:{flex:1,backgroundColor:'#eef3f8'}, centrado:{flex:1,justifyContent:'center',padding:22},
  tarjeta:{backgroundColor:'#fff',borderRadius:18,padding:24,elevation:3},
  icono:{fontSize:38,textAlign:'center'}, titulo:{fontSize:23,fontWeight:'800',color:'#17496d',textAlign:'center',marginTop:6},
  subtitulo:{textAlign:'center',color:'#64748b',fontSize:13,marginTop:8,marginBottom:24},
  etiqueta:{fontWeight:'700',color:'#243d50',marginBottom:7},
  campo:{borderColor:'#cdd8e2',borderWidth:1,borderRadius:9,padding:12,marginBottom:17,color:'#122b41',fontSize:16},
  boton:{backgroundColor:'#12678b',alignItems:'center',padding:15,borderRadius:11,minHeight:52,justifyContent:'center'},
  botonTexto:{color:'#fff',fontWeight:'800',fontSize:16},
  error:{color:'#b42318',marginBottom:12}, pie:{marginTop:18,color:'#6b7e8d',fontSize:12,textAlign:'center'}
});
