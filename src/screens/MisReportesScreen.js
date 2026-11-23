import React,{useCallback,useEffect,useState} from 'react';
import {SafeAreaView,View,Text,ScrollView,FlatList,Pressable,Modal,TextInput,Alert,ActivityIndicator,RefreshControl,StyleSheet} from 'react-native';
import {asignacionesApi} from '../services/asignacionesHospitalariasApi';
const NOM={asignado:'Asignado',programado:'Programado',en_proceso:'En proceso',pendiente_refacciones:'Pendiente refacciones',finalizado:'Finalizado',cancelado:'Cancelado',recibido:'Recibido'};
const fecha=v=>v?new Date(v).toLocaleString('es-MX'):'—';
const posibles=estado=>({asignado:['en_proceso'],programado:['en_proceso'],en_proceso:['pendiente_refacciones','finalizado'],pendiente_refacciones:['en_proceso','finalizado']})[estado]||[];
export default function MisReportesScreen(){
  const [reportes,setReportes]=useState([]),[avisos,setAvisos]=useState([]);
  const [cargando,setCargando]=useState(false),[error,setError]=useState('');
  const [seleccion,setSeleccion]=useState(null),[detalle,setDetalle]=useState(null),[estado,setEstado]=useState(''),[nota,setNota]=useState(''),[guardando,setGuardando]=useState(false);
  const cargar=useCallback(async()=>{
    setCargando(true);
    try{const [a,b]=await Promise.all([asignacionesApi.misReportes(),asignacionesApi.avisos()]);
      setReportes(a.reportes||[]);setAvisos(b.notificaciones||[]);setError('');
    }catch(e){setError(e.message||'No fue posible consultar tus reportes.');}finally{setCargando(false);}
  },[]);
  useEffect(()=>{cargar();const i=setInterval(cargar,60000);return()=>clearInterval(i);},[cargar]);
  const abrir=async(reporte,notificacionId)=>{
    setSeleccion(reporte);setDetalle(null);setEstado('');setNota('');
    try{
      if(notificacionId) await asignacionesApi.leerAviso(notificacionId);
      const d=await asignacionesApi.miReporte(reporte.id);setDetalle(d);setEstado(d.reporte.estado);
      await cargar();
    }catch(e){setSeleccion(null);Alert.alert('No fue posible abrir',e.message);}
  };
  const abrirAviso=async(aviso)=>{
    const r=reportes.find(x=>String(x.id)===String(aviso.reporte_id));
    if(!r){try{await asignacionesApi.leerAviso(aviso.id);await cargar();}catch(_){}
      return Alert.alert('Reporte reasignado','Este reporte ya no está asignado a tu cuenta.');}
    await abrir(r,aviso.id);
  };
  const guardar=async()=>{
    if(!detalle||!estado||estado===detalle.reporte.estado)return;
    if(['finalizado','pendiente_refacciones'].includes(estado)&&nota.trim().length<10)
      return Alert.alert('Falta descripción','Escribe al menos 10 caracteres para explicar el cambio.');
    setGuardando(true);
    try{await asignacionesApi.estado(detalle.reporte.id,estado,nota);setSeleccion(null);setDetalle(null);await cargar();Alert.alert('Actualizado','El cambio quedó registrado en el historial.');}
    catch(e){Alert.alert('No se pudo guardar',e.message);}finally{setGuardando(false);}
  };
  const sinLeer=avisos.filter(x=>!x.leida_en);
  return <SafeAreaView style={s.root}>
    <View style={s.header}><Text style={s.title}>Mis reportes asignados</Text><Text style={s.sub}>Solo trabajos asignados a tu cuenta de técnico</Text></View>
    {!!error&&<Text style={s.error}>{error}</Text>}
    <FlatList data={reportes} keyExtractor={x=>String(x.id)} refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargar}/>}
      contentContainerStyle={s.list}
      ListHeaderComponent={<View>
        <Text style={s.section}>Avisos nuevos ({sinLeer.length})</Text>
        {sinLeer.length===0?<Text style={s.emptyInline}>No tienes avisos pendientes.</Text>:sinLeer.map(a=><Pressable key={String(a.id)} style={s.notice} onPress={()=>abrirAviso(a)}><Text style={s.noticeTitle}>🔔 {a.titulo}</Text><Text style={s.meta}>{a.mensaje}</Text><Text style={s.time}>{fecha(a.creada_en)}</Text></Pressable>)}
        <Text style={s.section}>Trabajos asignados ({reportes.length})</Text>
      </View>}
      ListEmptyComponent={!cargando?<Text style={s.empty}>Todavía no tienes reportes asignados.</Text>:<ActivityIndicator/>}
      renderItem={({item:r})=><Pressable style={s.card} onPress={()=>abrir(r)}><View style={s.lineRow}><Text style={s.folio}>{r.folio}</Text><Text style={s.status}>{NOM[r.estado]||r.estado}</Text></View><Text style={s.name}>{r.equipo}</Text><Text style={s.meta}>{r.hospital} · {r.area}</Text><Text style={s.meta}>Prioridad {r.prioridad}</Text><Text style={s.time}>Asignado: {fecha(r.asignado_en)}</Text></Pressable>}
    />
    <Modal visible={!!seleccion} animationType="slide" onRequestClose={()=>setSeleccion(null)}>
      <SafeAreaView style={s.root}>
        <View style={s.modalHeader}><Text style={s.title}>{seleccion?.folio||'Reporte'}</Text><Pressable onPress={()=>setSeleccion(null)}><Text style={s.close}>Cerrar ✕</Text></Pressable></View>
        {!detalle?<ActivityIndicator style={{marginTop:35}}/>:<ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.name}>{detalle.reporte.equipo}</Text><Text style={s.meta}>{detalle.reporte.hospital} · {detalle.reporte.area}</Text>
          <Text style={s.line}>Servicio: {detalle.reporte.tipo}</Text><Text style={s.line}>Prioridad: {detalle.reporte.prioridad}</Text>
          <Text style={s.line}>N.º serie: {detalle.reporte.numero_serie||'—'} · Inventario: {detalle.reporte.inventario||'—'}</Text>
          <Text style={s.label}>Descripción</Text><Text style={s.description}>{detalle.reporte.descripcion}</Text>
          <Text style={s.label}>Contacto del hospital</Text><Text style={s.line}>{detalle.reporte.reportante} · {detalle.reporte.contacto}</Text>
          <Text style={s.label}>Estado actual: {NOM[detalle.reporte.estado]||detalle.reporte.estado}</Text>
          {posibles(detalle.reporte.estado).length>0?<>
            <Text style={s.label}>Actualizar avance</Text><View style={s.states}>
              {[detalle.reporte.estado,...posibles(detalle.reporte.estado)].map(k=><Pressable key={k} onPress={()=>setEstado(k)} style={[s.chip,estado===k&&s.chipOn]}><Text style={[s.chipText,estado===k&&s.chipOnText]}>{NOM[k]||k}</Text></Pressable>)}
            </View><Text style={s.label}>Nota de trabajo</Text><TextInput style={s.notes} multiline maxLength={1000} value={nota} onChangeText={setNota} placeholder="Describe el trabajo realizado o refacciones pendientes"/>
            <Pressable disabled={guardando||estado===detalle.reporte.estado} onPress={guardar} style={[s.button,(guardando||estado===detalle.reporte.estado)&&{opacity:.4}]}><Text style={s.buttonText}>{guardando?'Guardando...':'Guardar avance'}</Text></Pressable>
          </>:<Text style={s.meta}>Este reporte no permite más cambios desde la cuenta de técnico.</Text>}
          <Text style={s.label}>Historial</Text>
          {(detalle.historial||[]).map((x,i)=><View key={i} style={s.history}><Text style={s.meta}>{NOM[x.estado_nuevo]||x.estado_nuevo} · {fecha(x.fecha)}</Text><Text style={s.line}>{x.actor}{x.nota?`: ${x.nota}`:''}</Text></View>)}
        </ScrollView>}
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:'#f3f7fa'},header:{padding:20},title:{fontSize:21,fontWeight:'800',color:'#18334c'},sub:{fontSize:12,color:'#6c8390',marginTop:6},list:{paddingHorizontal:16,paddingBottom:55},section:{fontWeight:'800',color:'#18334c',fontSize:16,marginTop:15,marginBottom:12},notice:{padding:15,borderRadius:12,backgroundColor:'#eaf7fb',marginBottom:9,borderWidth:1,borderColor:'#cae7f0'},noticeTitle:{fontSize:13,fontWeight:'800',color:'#175773'},card:{backgroundColor:'white',borderRadius:14,padding:16,borderWidth:1,borderColor:'#e0e9ee',marginBottom:12},lineRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},folio:{fontSize:13,fontWeight:'800',color:'#156b86'},status:{color:'#416b77',backgroundColor:'#e7f3f6',padding:7,borderRadius:9,fontSize:11},name:{fontSize:19,fontWeight:'800',color:'#203744',marginTop:9},meta:{fontSize:13,color:'#657f8d',marginTop:7},time:{fontSize:11,color:'#8197a2',marginTop:8},error:{color:'#b73836',padding:15},empty:{textAlign:'center',color:'#77909c',padding:28},emptyInline:{color:'#8197a2',marginBottom:12},modalHeader:{padding:17,backgroundColor:'white',flexDirection:'row',alignItems:'center',justifyContent:'space-between'},close:{color:'#12627b',fontWeight:'700'},scroll:{padding:18,paddingBottom:70},line:{fontSize:13,color:'#476171',marginTop:12,lineHeight:21},label:{fontSize:14,color:'#213d4c',fontWeight:'800',marginTop:22,marginBottom:7},description:{padding:14,backgroundColor:'white',lineHeight:21,borderRadius:12,color:'#314a58'},states:{flexDirection:'row',flexWrap:'wrap'},chip:{paddingHorizontal:13,paddingVertical:9,borderWidth:1,borderColor:'#cad9e2',borderRadius:20,marginRight:8,marginBottom:8},chipOn:{backgroundColor:'#176884',borderColor:'#176884'},chipText:{color:'#3f5c6e'},chipOnText:{color:'white'},notes:{minHeight:90,borderWidth:1,borderColor:'#d3dfe7',backgroundColor:'white',padding:12,borderRadius:10,textAlignVertical:'top'},button:{marginTop:18,padding:16,backgroundColor:'#176884',alignItems:'center',borderRadius:11},buttonText:{color:'white',fontWeight:'800'},history:{borderLeftWidth:2,borderLeftColor:'#a5ccda',paddingLeft:12,marginLeft:3,paddingVertical:9}
});
