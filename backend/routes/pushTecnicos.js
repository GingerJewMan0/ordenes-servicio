"use strict";
const express = require('express');
const RX_EXPO = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
function crearRouterPushTecnicos(pool, verificarSesionSiempre) {
  if (!pool?.query || typeof verificarSesionSiempre !== 'function') throw new Error('Falta autenticación real para push');
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(verificarSesionSiempre);
  router.use((req, res, next) => req.usuarioApp?.rol === 'tecnico'
    ? next() : res.status(403).json({error: 'Solo usuarios técnicos.'}));

  router.post('/registrar', async (req, res) => {
    const token = req.body?.expo_push_token;
    if (typeof token !== 'string' || !RX_EXPO.test(token)) {
      return res.status(400).json({error: 'Token Expo inválido.'});
    }
    try {
      await pool.query(`INSERT INTO public.reportes_hospitalarios_push_dispositivos
  (usuario_id, sesion_id, expo_push_token, activo, actualizado_en)
  VALUES ($1, $2, $3, TRUE, NOW())
  ON CONFLICT (expo_push_token) DO UPDATE
  SET usuario_id = EXCLUDED.usuario_id,
      sesion_id = EXCLUDED.sesion_id,
      activo = TRUE,
      actualizado_en = NOW()`,
[req.usuarioApp.id, req.usuarioApp.sesion_id, token]);
      return res.json({ok: true});
    } catch (error) {
      console.error('[push/registrar]', error?.code || 'error');
      return res.status(500).json({error: 'No se pudo registrar el dispositivo.'});
    }
  });

  router.post('/retirar', async (req, res) => {
    const token = req.body?.expo_push_token;
    if (typeof token !== 'string' || !RX_EXPO.test(token)) {
      return res.status(400).json({error: 'Token Expo inválido.'});
    }
    try {
      await pool.query(`DELETE FROM public.reportes_hospitalarios_push_dispositivos
        WHERE usuario_id=$1 AND expo_push_token=$2`, [req.usuarioApp.id, token]);
      res.json({ok:true});
    } catch (error) {
      console.error('[push/retirar]', error?.code || 'error');
      res.status(500).json({error: 'No se pudo retirar el dispositivo.'});
    }
  });
  return router;
}
module.exports = {crearRouterPushTecnicos};
