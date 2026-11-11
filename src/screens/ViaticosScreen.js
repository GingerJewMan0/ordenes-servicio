import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { eliminarViatico, listarViaticos } from '../services/viaticosLocal';
import { listarViaticosServidor, crearViaticoServidor, actualizarViaticoServidor, eliminarViaticoServidor, comprobarViaticoPorSolicitud, esGuardadoIncierto, explicarErrorViaticos } from '../services/viaticosApi';
import { compartirPdfViaticos, generarPdfViaticos } from '../services/pdfViaticos';
import { leerComprobantes, guardarComprobantes, pasarBorradorAViatico, borrarComprobantes, copiarComprobante, quitarArchivoComprobante } from '../services/comprobantesViaticos';

const RUBROS = [['casetas','Casetas'],['estacionamiento','Estacionamiento'],['gasolina','Gasolina'],['hospedaje','Hospedaje'],['comida','Comida'],['refacciones','Refacciones'],['material','Material'],['otros','Otros']];
const NOMBRES_DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const fechaIso = (date) => date.toISOString().slice(0,10);
const moverDia = (fecha, diferencia) => { const d=new Date(`${fecha}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+diferencia);return fechaIso(d); };
const lunesSemana = (fecha) => { const d=new Date(`${fecha}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return fechaIso(d); };
const hoy = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const gastosVacios = () => Object.fromEntries(RUBROS.map(([r])=>[r,'']));
const numero = (v) => {const s=String(v??'').trim().replace(',','.');if(!s)return 0;if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const n=Number(s);return Number.isFinite(n)&&n<=999999999 ? n : null;};
const dinero = (n) => `$${Number(n||0).toFixed(2)} MXN`;
const nuevaSemana = (base) => Array.from({length:7},(_,i)=>({fecha:moverDia(base,i),hospitales:'',proyecto:'',habilitado:i<5,gastos:gastosVacios()}));
const formularioVacio = () => ({folio:'',empleado:'',destino:'',semanaInicio:lunesSemana(hoy()),ordenRelacionada:'',motivo:'',observaciones:'',dias:nuevaSemana(lunesSemana(hoy()))});
function Campo({titulo,valor,cambio,placeholder='',multiline=false,teclado='default'}) {
  return <View style={s.campo}><Text style={s.etiqueta}>{titulo}</Text><TextInput style={[s.entrada,multiline&&s.area]} value={String(valor??'')} onChangeText={cambio} placeholder={placeholder} placeholderTextColor="#8794a1" keyboardType={teclado} multiline={multiline} textAlignVertical={multiline?'top':'center'}/></View>;
}
const Boton = ({texto,accion,secundario=false,deshabilitado=false}) => <TouchableOpacity disabled={deshabilitado} style={[s.boton,secundario&&s.botonSecundario,deshabilitado&&{opacity:0.5}]} onPress={accion}><Text style={s.botonTexto}>{texto}</Text></TouchableOpacity>;
export default function ViaticosScreen(){
  const scroll=useRef(null), guardado=useRef(false), idPeticion=useRef(null);
  const [form,setForm]=useState(formularioVacio);
  const [indiceDia,setIndiceDia]=useState(0);
  const [conceptoFoto,setConceptoFoto]=useState('casetas');
  const [fotos,setFotos]=useState([]);
  const [editarId,setEditarId]=useState(null);
  const [historial,setHistorial]=useState([]);
  const [locales,setLocales]=useState([]);
  const [cargando,setCargando]=useState(true);
  const [ocupado,setOcupado]=useState(false);
  const [errorServidor,setErrorServidor]=useState('');
  const [envioSinConfirmar,setEnvioSinConfirmar]=useState(false);
  const [cambioSinConfirmar,setCambioSinConfirmar]=useState(null);
  const actualizar=(campo,valor)=>setForm(a=>({...a,[campo]:valor}));
  const cambiarDia=(indice,cambio)=>setForm(a=>({...a,dias:a.dias.map((d,i)=>i===indice?{...d,...cambio}:d)}));
  const cambiarGasto=(indice,rubro,valor)=>setForm(a=>({...a,dias:a.dias.map((d,i)=>i===indice?{...d,gastos:{...d.gastos,[rubro]:valor}}:d)}));
  const refrescar=async()=>{
    const resultados=await Promise.allSettled([listarViaticosServidor(),listarViaticos()]);
    if(resultados[0].status==='fulfilled'){setHistorial(resultados[0].value);setErrorServidor('');}
    else setErrorServidor(explicarErrorViaticos(resultados[0].reason));
    if(resultados[1].status==='fulfilled')setLocales(resultados[1].value);
  };
  useEffect(()=>{refrescar().finally(()=>setCargando(false));leerComprobantes('borrador').then(setFotos).catch(()=>{});},[]);
  const dia=form.dias[indiceDia];
  const importes=useMemo(()=>form.dias.map(d=>Object.fromEntries(RUBROS.map(([r])=>[r,numero(d.gastos[r])]))),[form.dias]);
  const montoDia=(i)=>Object.values(importes[i]||{}).reduce((s,n)=>n===null?s:s+n,0);
  const montoRubro=(r)=>importes.reduce((s,d,i)=>s+(form.dias[i].habilitado?(d[r]||0):0),0);
  const total=form.dias.reduce((sum,d,i)=>sum+(d.habilitado?montoDia(i):0),0);
  const guardarFotoLista=async(lista)=>{
    setFotos(lista);
    await guardarComprobantes(editarId||'borrador',lista);
  };
  const tomarComprobante=async(desdeGaleria=false)=>{
    if(!dia.habilitado)return Alert.alert('Día inactivo','Activa este día antes de añadir comprobantes.');
    try {
      if(!desdeGaleria){const permiso=await ImagePicker.requestCameraPermissionsAsync();if(!permiso.granted)return Alert.alert('Permiso de cámara','Autoriza el uso de la cámara para fotografiar comprobantes.');}
      const opciones={mediaTypes:ImagePicker.MediaTypeOptions.Images,quality:0.68,allowsEditing:false};
      const resultado=desdeGaleria?await ImagePicker.launchImageLibraryAsync(opciones):await ImagePicker.launchCameraAsync(opciones);
      if(resultado.canceled||!resultado.assets?.[0]?.uri)return;
      const foto=await copiarComprobante(resultado.assets[0].uri,dia.fecha,conceptoFoto);
      await guardarFotoLista([...fotos,foto]);
    }catch(e){Alert.alert('No se pudo añadir la foto',e.message);}
  };
  const quitarFoto=(item)=>Alert.alert('Quitar comprobante','¿Eliminar esta fotografía del dispositivo?',[{text:'Cancelar',style:'cancel'},{text:'Quitar',style:'destructive',onPress:async()=>{await guardarFotoLista(fotos.filter(f=>f.id!==item.id));await quitarArchivoComprobante(item).catch(()=>{});}}]);
  const activarFinDeSemana=(i)=>{
    if(i<5)return;
    const actual=form.dias[i];
    if(actual.habilitado){
      const tieneGastos=RUBROS.some(([r])=>Number(actual.gastos[r])>0);
      if(tieneGastos||actual.hospitales.trim()||actual.proyecto.trim()||fotos.some(f=>f.fecha===actual.fecha))return Alert.alert('Día con información','Borra primero los gastos, hospitales y fotos de ese día para desactivarlo.');
    }
    cambiarDia(i,{habilitado:!actual.habilitado});
    if(!actual.habilitado)setIndiceDia(i);
    else setIndiceDia(0);
  };
  const cambiarSemana=(delta)=>{
    const nueva=moverDia(form.semanaInicio,delta*7);
    if(form.dias.some(d=>d.hospitales.trim()||d.proyecto.trim()||RUBROS.some(([r])=>String(d.gastos[r]).trim()))||fotos.length){
      Alert.alert('Ya hay datos','Guarda o inicia una comprobación nueva antes de cambiar de semana.');return;
    }
    setForm(a=>({...a,semanaInicio:nueva,dias:nuevaSemana(nueva)}));setIndiceDia(0);
  };
  const validar=()=>{
    if(!form.empleado.trim()||!form.destino.trim()||!form.motivo.trim())return 'Completa empleado, destino y motivo.';
    if(form.dias.some((d,i)=>d.habilitado&&Object.values(importes[i]).some(n=>n===null)))return 'Revisa los importes; máximo dos decimales.';
    return null;
  };
  const comprobacion=()=>{
    const dias=form.dias.filter(d=>d.habilitado).map((d)=>({fecha:d.fecha,hospitales:d.hospitales.trim(),proyecto:d.proyecto.trim(),gastos:Object.fromEntries(RUBROS.map(([r])=>[r,numero(d.gastos[r])]))}));
    return {empresaId:'general',empleado:form.empleado.trim(),destino:form.destino.trim(),fechaInicio:form.semanaInicio,fechaFin:dias[dias.length-1].fecha,ordenRelacionada:form.ordenRelacionada.trim(),motivo:form.motivo.trim(),observaciones:form.observaciones.trim(),dias};
  };
  const coincideComprobacion=(actual,solicitud)=>{
    const campos=['empleado','destino','fechaInicio','fechaFin','ordenRelacionada','motivo','observaciones'];
    if(campos.some(c=>String(actual[c]??'').trim()!==String(solicitud[c]??'').trim()))return false;
    if(!Array.isArray(actual.dias)||actual.dias.length!==solicitud.dias.length)return false;
    return solicitud.dias.every(d=>{
      const recibido=actual.dias.find(x=>x.fecha===d.fecha);
      if(!recibido||String(recibido.hospitales??'').trim()!==d.hospitales||String(recibido.proyecto??'').trim()!==d.proyecto)return false;
      return RUBROS.every(([r])=>Math.round(Number(recibido.gastos?.[r]||0)*100)===Math.round(Number(d.gastos?.[r]||0)*100));
    });
  };
  const nuevo=async()=>{
    // No descartar un identificador pendiente: un POST anterior podría continuar en Render.
    if(envioSinConfirmar||cambioSinConfirmar)return Alert.alert('Envío pendiente de comprobar','Usa «Comprobar último envío o cambio» antes de comenzar otra comprobación.');
    idPeticion.current=null;setEditarId(null);setForm(formularioVacio());setIndiceDia(0);
    setFotos(await leerComprobantes('borrador'));scroll.current?.scrollTo({y:0,animated:true});
  };
  const confirmarServidor=async(resultado,eraNuevo)=>{
    // Este paso se ejecuta SOLO después de obtener el registro de PostgreSQL.
    idPeticion.current=null;
    setEnvioSinConfirmar(false);
    setCambioSinConfirmar(null);
    setEditarId(resultado.id);
    setForm(a=>({...a,folio:resultado.folio}));
    setHistorial(a=>[resultado,...a.filter(v=>String(v.id)!==String(resultado.id))]);
    setErrorServidor('');
    let avisoFotos='';
    if(eraNuevo){
      try{await pasarBorradorAViatico(resultado.id,fotos);}
      catch(e){avisoFotos=` El viático SÍ quedó guardado, pero no se pudieron asociar las fotos locales: ${e.message}. No desinstales la app.`;}
    }
    return avisoFotos;
  };
  const guardar=async(conPdf)=>{
    if(ocupado||guardado.current)return;
    const err=validar();if(err)return Alert.alert('Revisa la comprobación',err);
    guardado.current=true;setOcupado(true);
    const eraNuevo=!editarId;
    let resultado;
    try {
      // Separar el guardado remoto de las operaciones de fotos y PDF:
      // un fallo local NUNCA debe anunciar falsamente un fallo en PostgreSQL.
      try {
        const solicitud=comprobacion();
        if(!eraNuevo)resultado=await actualizarViaticoServidor(editarId,solicitud);
        else {
          if(!idPeticion.current)idPeticion.current=`android_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
          resultado=await crearViaticoServidor(solicitud,idPeticion.current);
        }
      }catch(e){
        if(esGuardadoIncierto(e)){
          if(eraNuevo)setEnvioSinConfirmar(true);
          else setCambioSinConfirmar({id:String(editarId),solicitud:comprobacion()});
        }
        Alert.alert('Guardado no confirmado',explicarErrorViaticos(e));
        return;
      }
      const avisoFotos=await confirmarServidor(resultado,eraNuevo);
      try {
        if(conPdf){
          const uri=await generarPdfViaticos({...resultado,comprobantes:fotos});
          await compartirPdfViaticos(uri);
          if(avisoFotos)Alert.alert('Comprobación guardada; revisa las fotos',`Folio: ${resultado.folio}.${avisoFotos}`);
        }else{
          Alert.alert('Comprobación guardada',`Folio: ${resultado.folio}. ${fotos.length} foto(s) en este teléfono.${avisoFotos}`);
        }
      }catch(e){
        Alert.alert('Comprobación guardada; fallo del PDF',`Folio ${resultado.folio} confirmado en PostgreSQL. El PDF o el envío falló: ${e.message}${avisoFotos}`);
      }
      await refrescar();
    }finally{guardado.current=false;setOcupado(false);}
  };
  const comprobarUltimoEnvio=async()=>{
    if(ocupado||guardado.current||(!idPeticion.current&&!cambioSinConfirmar))return;
    guardado.current=true;setOcupado(true);
    try{
      let resultado, eraNuevo=true;
      if(cambioSinConfirmar){
        const actuales=await listarViaticosServidor();
        resultado=actuales.find(v=>String(v.id)===cambioSinConfirmar.id);
        if(!resultado||!coincideComprobacion(resultado,cambioSinConfirmar.solicitud)){
          return Alert.alert('Cambio aún no confirmado','Los datos consultados en PostgreSQL no coinciden todavía con el cambio enviado. Revisa los Logs antes de reintentar.');
        }
        eraNuevo=false;
      }else resultado=await comprobarViaticoPorSolicitud(idPeticion.current);
      const avisoFotos=await confirmarServidor(resultado,eraNuevo);
      Alert.alert('Guardado confirmado',`La comprobación sí estaba en PostgreSQL. Folio: ${resultado.folio}.${avisoFotos}`);
      await refrescar();
    }catch(e){
      if(e?.response?.status===404){
        Alert.alert('Aún no aparece en PostgreSQL','No se encontró todavía este identificador. El envío podría seguir procesándose. Comprueba los Logs y el historial antes de reintentar; el identificador se conserva para evitar duplicados.');
      }else Alert.alert('No fue posible verificar el envío',explicarErrorViaticos(e));
    }finally{guardado.current=false;setOcupado(false);}
  };
  const editar=async(item)=>{
    if(envioSinConfirmar||cambioSinConfirmar)return Alert.alert('Envío pendiente','Comprueba el último envío o cambio antes de editar otro viático.');
    if(!item.dias?.length)return Alert.alert('Registro anterior','Este viático se creó antes del desglose diario. Su información se conserva; puedes descargar su PDF histórico.');
    idPeticion.current=null;setEditarId(item.id);
    const base=lunesSemana(item.fechaInicio);
    const relleno=nuevaSemana(base).map((d,i)=>{
      const encontrado=item.dias.find(x=>x.fecha===d.fecha);
      return encontrado?{...d,habilitado:true,hospitales:encontrado.hospitales||'',proyecto:encontrado.proyecto||'',gastos:Object.fromEntries(RUBROS.map(([r])=>[r,encontrado.gastos?.[r]?String(encontrado.gastos[r]):'']))}:d;
    });
    // Si no se registró sábado o domingo, mantenerlos apagados.
    for(let i=5;i<7;i++)if(!item.dias.some(x=>x.fecha===relleno[i].fecha))relleno[i].habilitado=false;
    setForm({folio:item.folio,empleado:item.empleado||'',destino:item.destino||'',semanaInicio:base,ordenRelacionada:item.ordenRelacionada||'',motivo:item.motivo||'',observaciones:item.observaciones||'',dias:relleno});
    setFotos(await leerComprobantes(item.id));setIndiceDia(0);scroll.current?.scrollTo({y:0,animated:true});
  };
  const compartir=async(item)=>{
    setOcupado(true);try{const guardadas=await leerComprobantes(item.id);const uri=await generarPdfViaticos({...item,comprobantes:guardadas});await compartirPdfViaticos(uri);}catch(e){Alert.alert('Error al compartir PDF',e.message);}finally{setOcupado(false);}
  };
  const eliminar=({id,folio},local=false)=>Alert.alert('Eliminar viático',`¿Eliminar ${folio}? El folio no se reutilizará.`,[{text:'Cancelar',style:'cancel'},{text:'Eliminar',style:'destructive',onPress:async()=>{
    setOcupado(true);try{if(local){await eliminarViatico(id);setLocales(await listarViaticos());}else{await eliminarViaticoServidor(id);setHistorial(a=>a.filter(x=>String(x.id)!==String(id)));}if(String(editarId)===String(id))await nuevo();}catch(e){Alert.alert('No se pudo eliminar',e.message);}finally{setOcupado(false);}
  }}]);
  return <ScrollView ref={scroll} style={s.pantalla} contentContainerStyle={s.contenido} keyboardShouldPersistTaps="handled">
    <Text style={s.titulo}>Comprobación semanal de viáticos</Text><Text style={s.ayuda}>Registra los gastos realmente realizados de lunes a viernes. Activa sábado o domingo cuando haya servicios. Un folio por semana y comprobantes por día.</Text>
    {errorServidor?<Text style={s.advertencia}>{errorServidor}</Text>:null}
    <View style={s.tarjeta}>
      <Text style={s.etiqueta}>Folio (automático al guardar)</Text><Text style={s.folio}>{form.folio||'Se asigna desde PostgreSQL'}</Text>
      <Campo titulo="Nombre del empleado / técnico" valor={form.empleado} cambio={v=>actualizar('empleado',v)}/>
      <Campo titulo="Destino general" valor={form.destino} cambio={v=>actualizar('destino',v)} placeholder="Ciudades / ruta general"/>
      <Campo titulo="Orden de servicio relacionada (opcional)" valor={form.ordenRelacionada} cambio={v=>actualizar('ordenRelacionada',v)}/>
      <Campo titulo="Motivo de la comisión" valor={form.motivo} cambio={v=>actualizar('motivo',v)} multiline/>
    </View>
    <View style={s.tarjeta}>
      <Text style={s.subtitulo}>Semana que se comprueba</Text>
      <View style={s.semanaNav}><TouchableOpacity onPress={()=>cambiarSemana(-1)}><Text style={s.link}>‹ Semana anterior</Text></TouchableOpacity><Text style={s.semanaTexto}>{form.semanaInicio} — {moverDia(form.semanaInicio,6)}</Text><TouchableOpacity onPress={()=>cambiarSemana(1)}><Text style={s.link}>Siguiente ›</Text></TouchableOpacity></View>
      <Text style={s.ayuda}>Selecciona cada día, registra hospitales, proyecto realizado y gastos comprobados.</Text>
      <View style={s.diasLista}>{form.dias.map((d,i)=><TouchableOpacity key={d.fecha} onPress={()=>i<5||d.habilitado?setIndiceDia(i):activarFinDeSemana(i)} style={[s.diaBoton,indiceDia===i&&s.diaElegido,!d.habilitado&&s.diaInactivo]}><Text style={s.diaTexto}>{NOMBRES_DIAS[i]} {d.fecha.slice(8)}</Text><Text style={s.diaMonto}>{d.habilitado?dinero(montoDia(i)):'Inactivo'}</Text></TouchableOpacity>)}</View>
      {indiceDia>=5?<TouchableOpacity onPress={()=>activarFinDeSemana(indiceDia)}><Text style={s.link}>{dia.habilitado?'Desactivar este día':'Activar día extraordinario'}</Text></TouchableOpacity>:null}
      {dia.habilitado?<>
        <Text style={s.subtitulo}>{NOMBRES_DIAS[indiceDia]} · {dia.fecha}</Text>
        <Campo titulo="Hospitales / unidades visitadas este día" valor={dia.hospitales} cambio={v=>cambiarDia(indiceDia,{hospitales:v})} placeholder="Hospital A, Hospital B..." multiline/>
        <Campo titulo="Proyecto realizado este día" valor={dia.proyecto} cambio={v=>cambiarDia(indiceDia,{proyecto:v})} placeholder="Ej. Instalación de monitor, mantenimiento preventivo..." multiline/>
        {RUBROS.map(([id,nombre])=><Campo key={`${dia.fecha}-${id}`} titulo={nombre} valor={dia.gastos[id]} cambio={v=>cambiarGasto(indiceDia,id,v)} placeholder="0.00" teclado="decimal-pad"/>)}
        <View style={s.totalFila}><Text style={s.etiqueta}>Total comprobado del día</Text><Text style={s.totalValor}>{dinero(montoDia(indiceDia))}</Text></View>
        <Text style={s.subtitulo}>Comprobantes fotográficos</Text>
        <Text style={s.ayuda}>Elige a qué gasto corresponde cada foto. Se conserva en este teléfono; no se sube al servidor.</Text>
        <View style={s.conceptos}>{RUBROS.map(([id,nombre])=><TouchableOpacity key={id} style={[s.rubroChip,conceptoFoto===id&&s.chipActivo]} onPress={()=>setConceptoFoto(id)}><Text style={s.chipTexto}>{nombre}</Text></TouchableOpacity>)}</View>
        <View style={s.botonesFoto}><TouchableOpacity onPress={()=>tomarComprobante(false)} style={s.fotoBoton}><Text style={s.botonTexto}>📷 Tomar foto</Text></TouchableOpacity><TouchableOpacity onPress={()=>tomarComprobante(true)} style={s.fotoBoton}><Text style={s.botonTexto}>Galería</Text></TouchableOpacity></View>
        <View style={s.fotosLista}>{fotos.filter(f=>f.fecha===dia.fecha).map(item=><View key={item.id} style={s.fotoItem}><Image source={{uri:item.uri}} style={s.fotoMini}/><Text style={s.fotoEtiqueta}>{RUBROS.find(([r])=>r===item.concepto)?.[1]||item.concepto}</Text><TouchableOpacity onPress={()=>quitarFoto(item)}><Text style={s.rojo}>Quitar</Text></TouchableOpacity><TouchableOpacity onPress={()=>Sharing.shareAsync(item.uri).catch(e=>Alert.alert('Error',e.message))}><Text style={s.link}>Enviar</Text></TouchableOpacity></View>)}</View>
      </>:<Text style={s.ayuda}>Día no incluido.</Text>}
      <Text style={s.subtitulo}>Resumen de visitas y proyectos por día</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator style={{marginBottom:10}}>
        <View>
          <View style={s.cuadriculaFila}><Text style={[s.cuadriculaCelda,s.cuadriculaPrimera,s.cuadriculaCabecera]}>Día</Text>{form.dias.map((d,i)=><Text key={d.fecha} style={[s.cuadriculaCelda,s.cuadriculaCabecera]}>{NOMBRES_DIAS[i].slice(0,3)} {d.fecha.slice(8)}</Text>)}</View>
          {[['Hospitales visitados','hospitales'],['Proyecto','proyecto']].map(([titulo,campo])=><View key={campo} style={s.cuadriculaFila}><Text style={[s.cuadriculaCelda,s.cuadriculaPrimera]}>{titulo}</Text>{form.dias.map(d=><Text key={d.fecha} numberOfLines={3} style={s.cuadriculaCelda}>{d.habilitado?(d[campo]?.trim()||'—'):'—'}</Text>)}</View>)}
        </View>
      </ScrollView>
      <Text style={s.subtitulo}>Gastos comprobados por concepto</Text>
      {RUBROS.map(([r,n])=><View key={r} style={s.resumenFila}><Text>{n}</Text><Text>{dinero(montoRubro(r))}</Text></View>)}
      <View style={s.totalFila}><Text style={s.totalValor}>Total comprobado de la semana</Text><Text style={s.totalValor}>{dinero(total)}</Text></View>
      <Campo titulo="Observaciones (opcional)" valor={form.observaciones} cambio={v=>actualizar('observaciones',v)} multiline/>
    </View>
    {(envioSinConfirmar||cambioSinConfirmar)?<View style={s.tarjeta}><Text style={s.advertencia}>El último envío o cambio no recibió confirmación. Comprueba primero si Render lo registró para evitar errores o duplicados.</Text><Boton texto="Comprobar último envío o cambio" accion={comprobarUltimoEnvio} deshabilitado={ocupado}/></View>:null}
    <Boton texto={ocupado?'Guardando...':editarId?'Guardar cambios en PostgreSQL':'Guardar comprobación en PostgreSQL'} accion={()=>guardar(false)} deshabilitado={ocupado}/>
    <Boton texto="Guardar y compartir comprobación PDF" accion={()=>guardar(true)} deshabilitado={ocupado} secundario/>
    <TouchableOpacity onPress={nuevo} disabled={ocupado} style={s.nuevo}><Text style={s.link}>+ Nueva comprobación semanal</Text></TouchableOpacity>
    <View style={s.tarjeta}><Text style={s.subtitulo}>Historial de comprobaciones en PostgreSQL</Text><TouchableOpacity onPress={refrescar} disabled={ocupado}><Text style={s.link}>Actualizar historial</Text></TouchableOpacity>
      {cargando?<ActivityIndicator/>:historial.length===0?<Text style={s.ayuda}>Sin registros.</Text>:historial.map(item=><View key={String(item.id)} style={s.historial}><Text style={s.subtitulo}>{item.folio} · {dinero(item.total)}</Text><Text>{item.empleado} · {item.destino}</Text><Text style={s.ayuda}>{item.fechaInicio} a {item.fechaFin}</Text><View style={s.acciones}><TouchableOpacity onPress={()=>editar(item)} disabled={ocupado}><Text style={s.link}>Editar</Text></TouchableOpacity><TouchableOpacity onPress={()=>compartir(item)} disabled={ocupado}><Text style={s.link}>PDF</Text></TouchableOpacity><TouchableOpacity onPress={()=>eliminar(item)} disabled={ocupado}><Text style={s.rojo}>Eliminar</Text></TouchableOpacity></View></View>)}
    </View>
    {locales.length?<View style={s.tarjeta}><Text style={s.subtitulo}>Comprobaciones anteriores (solo locales)</Text>{locales.map(item=><View key={String(item.id)} style={s.historial}><Text>{item.folio} · {dinero(item.total)}</Text><View style={s.acciones}><TouchableOpacity onPress={()=>compartir(item)}><Text style={s.link}>PDF antiguo</Text></TouchableOpacity><TouchableOpacity onPress={()=>eliminar(item,true)}><Text style={s.rojo}>Eliminar</Text></TouchableOpacity></View></View>)}</View>:null}
    <Text style={s.advertencia}>Las fotos de comprobantes se conservan solo en este dispositivo. No desinstales la app si aún no las has respaldado. El backend actual carece de autenticación: no subas imágenes con datos personales hasta proteger el acceso.</Text>
  </ScrollView>;
}
const s=StyleSheet.create({
  pantalla:{flex:1,backgroundColor:'#f4f7fa'},contenido:{padding:16,paddingBottom:30},titulo:{fontSize:23,color:'#123b61',fontWeight:'800',marginBottom:7},subtitulo:{fontSize:17,color:'#174b73',fontWeight:'700',marginTop:8,marginBottom:10},ayuda:{fontSize:12,color:'#64748b',lineHeight:18,marginBottom:12},tarjeta:{backgroundColor:'#fff',padding:15,borderRadius:12,marginTop:14,elevation:2},campo:{marginBottom:12},etiqueta:{fontSize:13,fontWeight:'700',color:'#25364a',marginBottom:5},entrada:{borderWidth:1,borderColor:'#ccd5df',borderRadius:8,paddingHorizontal:11,paddingVertical:9,minHeight:42,color:'#1e293b',backgroundColor:'#fff'},area:{minHeight:64},folio:{borderWidth:1,borderColor:'#cdd8e3',padding:12,borderRadius:8,marginBottom:13,color:'#254862'},semanaNav:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:6,marginBottom:12},semanaTexto:{fontSize:11,color:'#334155',textAlign:'center',flex:1},link:{color:'#1565a0',fontWeight:'700',fontSize:12},diasLista:{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:12},diaBoton:{width:'31%',padding:8,borderRadius:8,borderWidth:1,borderColor:'#cbd5e1',backgroundColor:'#f8fafc'},diaElegido:{borderColor:'#1c6e9e',backgroundColor:'#e5f3ff'},diaInactivo:{opacity:0.6},diaTexto:{fontWeight:'700',fontSize:12,color:'#23405d'},diaMonto:{fontSize:10,color:'#5b6f81',marginTop:4},totalFila:{flexDirection:'row',justifyContent:'space-between',padding:12,backgroundColor:'#e6f3fa',borderRadius:8,marginTop:9},totalValor:{fontSize:15,fontWeight:'800',color:'#17466b'},resumenFila:{flexDirection:'row',justifyContent:'space-between',paddingVertical:6,borderBottomColor:'#edf2f7',borderBottomWidth:1},conceptos:{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:10},rubroChip:{paddingHorizontal:9,paddingVertical:7,borderRadius:20,backgroundColor:'#eef2f7'},chipActivo:{backgroundColor:'#9fddfb'},chipTexto:{fontSize:11,color:'#153958'},botonesFoto:{flexDirection:'row',gap:8,marginBottom:12},fotoBoton:{backgroundColor:'#286993',padding:12,flex:1,alignItems:'center',borderRadius:8},fotosLista:{flexDirection:'row',flexWrap:'wrap',gap:8},fotoItem:{width:112,padding:5,backgroundColor:'#f8fafc',borderRadius:8,alignItems:'center',gap:3},fotoMini:{width:95,height:100,borderRadius:6},fotoEtiqueta:{fontSize:11,color:'#334155'},rojo:{color:'#b12828',fontWeight:'700',fontSize:12},boton:{padding:14,backgroundColor:'#176a9a',alignItems:'center',borderRadius:9,marginTop:14},botonSecundario:{backgroundColor:'#13765a'},botonTexto:{color:'#fff',fontWeight:'800'},nuevo:{padding:16,alignItems:'center'},historial:{borderTopWidth:1,borderTopColor:'#e2e8f0',paddingVertical:11},acciones:{flexDirection:'row',gap:25,marginTop:9},advertencia:{fontSize:12,color:'#86521b',lineHeight:18,marginTop:15,padding:8,backgroundColor:'#fff5df',borderRadius:7},cuadriculaFila:{flexDirection:'row'},cuadriculaCelda:{width:104,minHeight:48,borderWidth:0.5,borderColor:'#cbd5e1',padding:6,color:'#334155',fontSize:11},cuadriculaPrimera:{width:128,fontWeight:'700'},cuadriculaCabecera:{minHeight:33,fontWeight:'700',backgroundColor:'#e9f3f9',color:'#174b73'}
});
