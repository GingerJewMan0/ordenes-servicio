"use strict";
// El envío utiliza exclusivamente el servicio público de Expo; las claves FCM
// ya se gestionan en el panel de Expo y nunca se almacenan aquí.
const URL_EXPO = 'https://exp.host/--/api/v2/push/send';
async function enviarPushAsignacion(pool, tecnicoId, folio, reporteId) {
  const {rows} = await pool.query(`
  SELECT d.expo_push_token
  FROM public.reportes_hospitalarios_push_dispositivos d
  JOIN public.app_sesiones s
    ON s.id = d.sesion_id
   AND s.usuario_id = d.usuario_id
  JOIN public.app_usuarios u
    ON u.id = d.usuario_id
  WHERE d.usuario_id = $1
    AND d.activo = TRUE
    AND s.revocado_en IS NULL
    AND s.vence_en > NOW()
    AND u.activo = TRUE
    AND u.rol = 'tecnico'
  ORDER BY d.actualizado_en DESC
  LIMIT 50
`, [tecnicoId]);
  if (rows.length === 0) return {enviados: 0};
  const mensajes = rows.map(row => ({
    to: row.expo_push_token,
    title: 'Nuevo reporte asignado',
    body: 'Tienes una nueva asignación de Servicio Técnico. Abre Mis reportes.',
    data: {tipo: 'reporte_asignado', reporteId: String(reporteId)},
    channelId: 'reportes',
    priority: 'high',
    sound: 'default',
  }));
  const headers = {'Content-Type': 'application/json', 'Accept': 'application/json'};
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const respuesta = await fetch(URL_EXPO, {
    method:'POST', headers, body: JSON.stringify(mensajes), signal: AbortSignal.timeout(15000),
  });
  if (!respuesta.ok) throw new Error(`Expo no aceptó la petición (${respuesta.status}).`);
  const payload = await respuesta.json();
  const boletos = Array.isArray(payload?.data) ? payload.data : [payload?.data];
  for (let i=0; i < boletos.length && i < rows.length; i++) {
    const ticket = boletos[i];
    if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
      await pool.query(`DELETE FROM public.reportes_hospitalarios_push_dispositivos
          WHERE expo_push_token=$1 AND usuario_id=$2`, [rows[i].expo_push_token, tecnicoId]);
    } else if (ticket?.status === 'error') {
      console.warn('[push/asignacion] Expo rechazó un mensaje:', ticket?.details?.error || 'sin detalle');
    }
  }
  return {enviados: boletos.filter(b => b?.status === 'ok').length};
}
module.exports = {enviarPushAsignacion};
