import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  SafeAreaView, Modal, ScrollView, TextInput, Alert, ActivityIndicator
} from 'react-native';
import {crearApiReportesHospitalarios} from '../services/reportesHospitalariosApi';
import {asignacionesApi} from '../services/asignacionesHospitalariasApi';

const ESTADOS = [
  {key:'recibido',label:'Recibido'},
  {key:'en_revision',label:'En revisión'},
  {key:'asignado',label:'Asignado'},
  {key:'programado',label:'Programado'},
  {key:'en_proceso',label:'En proceso'},
  {key:'pendiente_refacciones',label:'Pendiente refacciones'},
  {key:'finalizado',label:'Finalizado'},
  {key:'cancelado',label:'Cancelado'}
];
const estadoNombre = s => ESTADOS.find(e=>e.key===s)?.label || s;
const tipoNombre = t => ({fuera_servicio:'Equipo fuera de servicio',correctivo:'Mantenimiento correctivo',preventivo:'Mantenimiento preventivo',instalacion:'Instalación',apertura:'Apertura / puesta en marcha'})[t] || t;
const fecha = v => v ? new Date(v).toLocaleString('es-MX') : '—';

/**
 * Esta pantalla utiliza el axios global que configura authSesion.js.
 * authSesion.js fue revisado: axios añade Bearer al host del login y reportes.
 * Solo visible a usuarios admin; backend valida el rol otra vez.
 */
export default function ReportesHospitalariosScreen() {
  const api = useMemo(() => {
      return crearApiReportesHospitalarios();
  }, []);
  const [reportes,setReportes]=useState([]);
  const [filtro,setFiltro]=useState('');
  const [cargando,setCargando]=useState(false);
  const [error,setError]=useState('');
  const [seleccion,setSeleccion]=useState(null);
  const [detalle,setDetalle]=useState(null);
  const [estado,setEstado]=useState('recibido');
  const [nota,setNota]=useState('');
  const [guardando,setGuardando]=useState(false);
  const [nuevos,setNuevos]=useState(0);
  const [tecnicos,setTecnicos]=useState([]);
  const [tecnicoElegido,setTecnicoElegido]=useState('');
  const [asignacion,setAsignacion]=useState(null);
  const [notaAsignacion,setNotaAsignacion]=useState('');
  const [asignando,setAsignando]=useState(false);
  const [errorTecnicos,setErrorTecnicos]=useState('');
  const cargar=useCallback(async()=>{
    if(!api) return;
    setCargando(true);
    try {
      const [lista,resumen]=await Promise.all([api.listar(filtro),api.resumen()]);
      setReportes(lista.reportes||[]);
      setNuevos(resumen.nuevos||0);
      setError('');
    } catch(e) {setError(e.message||'No se pudieron cargar los reportes.');}
    finally {setCargando(false);}
  },[api,filtro]);
  useEffect(()=>{cargar();const i=setInterval(cargar,60000);return()=>clearInterval(i);},[cargar]);
  const abrir=async(r)=>{
    setSeleccion(r);setDetalle(null);setEstado(r.estado);setNota('');
    try {
      const d=await api.detalle(r.id);
      setDetalle(d);
    }catch(e){setSeleccion(null);setDetalle(null);return Alert.alert('No se pudo abrir',e.message);}
    try {
      const [t,a]=await Promise.all([asignacionesApi.tecnicos(),asignacionesApi.asignacion(r.id)]);
      setTecnicos(t.tecnicos||[]);setAsignacion(a.asignacion||null);
      setTecnicoElegido(a.asignacion?.tecnico_id||'');setErrorTecnicos('');
    }catch(e){setTecnicos([]);setAsignacion(null);setTecnicoElegido('');setErrorTecnicos('Asignación no disponible: '+e.message);}
  };
  const guardar=async()=>{
    if(!seleccion||!api)return;
    if(estado==='cancelado' && nota.trim().length<5) return Alert.alert('Falta motivo','Escribe un motivo de cancelación.');
    setGuardando(true);
    try {await api.actualizar(seleccion.id,estado,nota);setSeleccion(null);setDetalle(null);await cargar();Alert.alert('Guardado','El reporte fue actualizado y el cambio quedó en el historial.');}
    catch(e){Alert.alert('Error al guardar',e.message);}finally{setGuardando(false);}
  };

  const asignar=async()=>{
    if(!seleccion||!tecnicoElegido)return Alert.alert('Selecciona un técnico','Elige un usuario técnico activo.');
    if(String(asignacion?.tecnico_id||'')===String(tecnicoElegido))return Alert.alert('Sin cambios','Ya está asignado a ese técnico.');
    setAsignando(true);
    try{
      const x=await asignacionesApi.asignar(seleccion.id,tecnicoElegido,notaAsignacion);
      const [d,a]=await Promise.all([api.detalle(seleccion.id),asignacionesApi.asignacion(seleccion.id)]);
      setDetalle(d);setAsignacion(a.asignacion);setEstado(d.reporte.estado);setNotaAsignacion('');
      await cargar();
      Alert.alert('Técnico asignado',`${x.folio} quedó asignado a ${x.tecnico}. El aviso estará en su aplicación.`);
    }catch(e){Alert.alert('No se pudo asignar',e.message);}finally{setAsignando(false);}
  };
  return <SafeAreaView style={s.container}>
    <View style={s.header}><View><Text style={s.title}>Reportes hospitalarios</Text><Text style={s.sub}>Solicitudes enviadas mediante códigos QR</Text></View><Text style={s.count}>{nuevos} recibidos</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters} contentContainerStyle={s.filterContent}>
      {[{key:'',label:'Todos'},...ESTADOS].map(x=><Pressable key={x.key} onPress={()=>setFiltro(x.key)} style={[s.filter,filtro===x.key && s.filterSelected]}><Text style={[s.filterText,filtro===x.key && s.filterSelectedText]}>{x.label}</Text></Pressable>)}
    </ScrollView>
    {!!error && <Text style={s.error}>{error}</Text>}
    <FlatList data={reportes} keyExtractor={r=>String(r.id)}
      refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargar}/>}
      contentContainerStyle={s.list}
      ListEmptyComponent={!cargando ? <Text style={s.empty}>No hay reportes en esta categoría.</Text> : <ActivityIndicator/>}
      renderItem={({item:r})=><Pressable onPress={()=>abrir(r)} style={s.card}>
        <View style={s.cardTop}><Text style={s.folio}>{r.folio}</Text><Text style={s.badge}>{estadoNombre(r.estado)}</Text></View>
        <Text style={s.equipo}>{r.equipo}</Text><Text style={s.hospital}>{r.hospital} · {r.area}</Text>
        <Text style={s.meta}>{tipoNombre(r.tipo)}  ·  Prioridad {r.prioridad}</Text>
        <Text style={s.fecha}>{fecha(r.creado_en)}</Text>
      </Pressable>}
    />
    <Modal visible={!!seleccion} animationType="slide" onRequestClose={()=>setSeleccion(null)}>
      <SafeAreaView style={s.container}>
        <View style={s.modalHeader}><Text style={s.title}>{seleccion?.folio || 'Reporte'}</Text><Pressable onPress={()=>setSeleccion(null)}><Text style={s.close}>Cerrar ✕</Text></Pressable></View>
        {!detalle ? <ActivityIndicator style={{marginTop:40}}/> : <ScrollView contentContainerStyle={s.detail}>
          <Text style={s.detailTitle}>{detalle.reporte.equipo}</Text>
          <Text style={s.hospital}>{detalle.reporte.hospital} · {detalle.reporte.area}</Text>
          <Text style={s.line}>Servicio: {tipoNombre(detalle.reporte.tipo)}</Text>
          <Text style={s.line}>Prioridad: {detalle.reporte.prioridad}</Text>
          <Text style={s.line}>Marca y modelo: {[detalle.reporte.marca,detalle.reporte.modelo].filter(Boolean).join(' ') || '—'}</Text>
          <Text style={s.line}>N/S: {detalle.reporte.numero_serie || '—'} · Inventario: {detalle.reporte.inventario || '—'}</Text>
          <Text style={s.label}>Descripción</Text><Text style={s.description}>{detalle.reporte.descripcion}</Text>
          <Text style={s.label}>Reportado por</Text><Text style={s.line}>{detalle.reporte.reportante} · {detalle.reporte.contacto}</Text>
          <Text style={s.label}>Asignación del técnico</Text>
          <Text style={s.line}>Técnico actual: {asignacion?.tecnico||'Sin asignar'}</Text>
          {!!errorTecnicos && <Text style={s.error}>{errorTecnicos}</Text>}
          {tecnicos.length===0?<Text style={s.meta}>No hay usuarios técnicos activos. No se puede asignar todavía.</Text>:<View style={s.states}>
            {tecnicos.map(t=><Pressable key={t.id} onPress={()=>setTecnicoElegido(String(t.id))} style={[s.filter,String(tecnicoElegido)===String(t.id)&&s.filterSelected]}><Text style={[s.filterText,String(tecnicoElegido)===String(t.id)&&s.filterSelectedText]}>{t.usuario}</Text></Pressable>)}
          </View>}
          <TextInput style={s.notes} value={notaAsignacion} onChangeText={setNotaAsignacion} maxLength={500} multiline placeholder="Nota opcional para el historial de asignación"/>
          <Pressable disabled={asignando||!tecnicoElegido||['cancelado','finalizado'].includes(detalle.reporte.estado)} onPress={asignar} style={[s.primary,(asignando||!tecnicoElegido||['cancelado','finalizado'].includes(detalle.reporte.estado))&&{opacity:.45}]}><Text style={s.primaryText}>{asignando?'Asignando…':'Asignar / reasignar técnico'}</Text></Pressable>
          <Text style={s.label}>Actualizar estado</Text>
          <View style={s.states}>{ESTADOS.map(x=><Pressable key={x.key} onPress={()=>setEstado(x.key)} style={[s.filter,estado===x.key&&s.filterSelected]}><Text style={[s.filterText,estado===x.key&&s.filterSelectedText]}>{x.label}</Text></Pressable>)}</View>
          <Text style={s.label}>Nota de seguimiento</Text>
          <TextInput style={s.notes} value={nota} onChangeText={setNota} multiline numberOfLines={3} maxLength={1000} placeholder="Notas para el historial de Servicio Técnico"/>
          <Pressable disabled={guardando} onPress={guardar} style={[s.primary,guardando&&{opacity:.6}]}><Text style={s.primaryText}>{guardando?'Guardando…':'Guardar estado y nota'}</Text></Pressable>
          <Text style={s.label}>Historial</Text>
          {(detalle.historial||[]).map((x,i)=><View style={s.history} key={i}><Text style={s.historyTitle}>{estadoNombre(x.estado_nuevo)} · {fecha(x.fecha)}</Text><Text style={s.meta}>{x.actor}{x.nota ? `: ${x.nota}` : ''}</Text></View>)}
        </ScrollView>}
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const s=StyleSheet.create({
  container:{flex:1,backgroundColor:'#f4f7fa'},header:{padding:18,paddingBottom:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:20,fontWeight:'800',color:'#162b3b'},sub:{fontSize:12,color:'#778a98',marginTop:4},count:{fontSize:11,fontWeight:'800',color:'#185f78',backgroundColor:'#e1f1f6',paddingHorizontal:10,paddingVertical:7,borderRadius:100},filters:{flexGrow:0,maxHeight:57},filterContent:{paddingHorizontal:18,paddingVertical:7,alignItems:'center'},filter:{borderWidth:1,borderColor:'#d1dce5',paddingHorizontal:12,paddingVertical:8,borderRadius:30,marginRight:8,marginBottom:6},filterSelected:{backgroundColor:'#156884',borderColor:'#156884'},filterText:{fontSize:12,color:'#516b7b'},filterSelectedText:{color:'white'},list:{padding:17,paddingTop:8,paddingBottom:60},card:{backgroundColor:'white',borderColor:'#e0e9ee',borderWidth:1,borderRadius:14,padding:16,marginBottom:12},cardTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},folio:{fontWeight:'800',fontSize:12,color:'#1b6c88'},badge:{fontSize:11,color:'#466b7b',backgroundColor:'#eaf3f6',paddingVertical:5,paddingHorizontal:8,borderRadius:9},equipo:{fontSize:17,fontWeight:'700',color:'#1a2935',marginTop:11},hospital:{fontSize:13,color:'#607a88',marginTop:5},meta:{fontSize:12,color:'#69818e',marginTop:7},fecha:{fontSize:11,color:'#93a2ac',marginTop:9},empty:{color:'#7c909b',textAlign:'center',padding:30},error:{color:'#a84634',padding:14},modalHeader:{padding:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:'#dce6ec',backgroundColor:'white'},close:{color:'#155e7c',fontWeight:'700'},detail:{padding:18,paddingBottom:60},detailTitle:{fontSize:23,fontWeight:'800',color:'#152e3c'},line:{fontSize:13,color:'#476472',marginTop:12},label:{fontSize:13,fontWeight:'800',color:'#253e4f',marginTop:22,marginBottom:7},description:{padding:12,backgroundColor:'white',borderRadius:10,lineHeight:20,color:'#324b59'},states:{flexDirection:'row',flexWrap:'wrap'},notes:{borderWidth:1,borderColor:'#c6d5de',borderRadius:10,minHeight:86,textAlignVertical:'top',backgroundColor:'white',padding:12,color:'#263c48'},primary:{marginTop:16,backgroundColor:'#156884',padding:15,borderRadius:10,alignItems:'center'},primaryText:{color:'white',fontWeight:'800'},history:{borderLeftWidth:2,borderLeftColor:'#a7ccd9',paddingLeft:12,paddingVertical:9,marginLeft:3},historyTitle:{color:'#2a4959',fontWeight:'700',fontSize:12}
});
