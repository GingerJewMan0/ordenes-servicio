import axios from 'axios';
import {API_AUTH_URL} from './authSesion';
const ORIGEN=API_AUTH_URL.replace(/\/api\/auth\/?$/, '');
const RUTA='/api/reportes-asignaciones';
async function pedir(method, suffix, data) {
  try {
    const response=await axios({method,url:`${ORIGEN}${RUTA}${suffix}`,timeout:30000,
      ...(data===undefined?{}:{data}),headers:{Accept:'application/json'}});
    return response.data;
  } catch(e) {
    const msg=e?.response?.data?.error || (e?.response?.status===401?'Sesión caducada.':e?.message||'Error de conexión.');
    throw new Error(msg);
  }
}
export const asignacionesApi={
  tecnicos:()=>pedir('get','/admin/tecnicos'),
  asignacion:id=>pedir('get',`/admin/${encodeURIComponent(String(id))}/asignacion`),
  asignar:(id,tecnico_id,nota='')=>pedir('post',`/admin/${encodeURIComponent(String(id))}/asignar`,{tecnico_id,nota}),
  misReportes:()=>pedir('get','/mis'),
  miReporte:id=>pedir('get',`/mis/${encodeURIComponent(String(id))}`),
  avisos:()=>pedir('get','/mis/notificaciones'),
  leerAviso:id=>pedir('patch',`/mis/notificaciones/${encodeURIComponent(String(id))}/leer`,{}),
  estado:(id,estado,nota)=>pedir('patch',`/mis/${encodeURIComponent(String(id))}/estado`,{estado,nota})
};
