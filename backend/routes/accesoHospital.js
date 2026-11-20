'use strict';
// Pagina de acceso por hospital, sin cambiar el formulario existente /hospital/:token.
// El enlace contiene una credencial de reporte: compartir solo con personal autorizado.
const express = require('express');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{43}$/;
const ORIGEN_PREDETERMINADO = 'https://ordenes-viaticos-test.onrender.com';

function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, caracter => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caracter]);
}

function crearRouterAccesoHospital(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('Se requiere la conexion PostgreSQL del backend.');
  }
  const router = express.Router();
  const limitar = rateLimit({windowMs: 15 * 60 * 1000, limit: 60,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: 'Demasiadas consultas. Intenta nuevamente mas tarde.'});

  router.get('/:token', limitar, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy',
      "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const token = req.params.token;
    if (!TOKEN_VALIDO.test(token || '')) {
      return res.status(404).send('Enlace de hospital no valido.');
    }
    try {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const {rows} = await pool.query(
        'SELECT nombre FROM public.hospitales_reportantes WHERE token_sha256=$1 AND activo=TRUE',
        [hash]
      );
      const hospital = rows[0];
      if (!hospital) return res.status(404).send('Enlace de hospital no disponible.');

      // No confiar en el Host de la peticion para construir el QR.
      const configurado = process.env.REPORTES_WEB_ORIGIN || ORIGEN_PREDETERMINADO;
      const origen = new URL(configurado);
      if (origen.protocol !== 'https:' || origen.pathname !== '/' || origen.search || origen.hash || origen.username || origen.password) {
        throw new Error('REPORTES_WEB_ORIGIN debe ser un origen HTTPS sin ruta.');
      }
      const rutaFormulario = `/hospital/${token}`;
      const enlaceFormulario = new URL(rutaFormulario, origen).toString();
      const qrSvg = await QRCode.toString(enlaceFormulario, {
        type: 'svg', width: 280, margin: 2, errorCorrectionLevel: 'M'
      });
      const nombre = escaparHtml(hospital.nombre);
      return res.status(200).type('html').send(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<title>Acceso a reportes | Servicio Tecnico</title>
<link rel="stylesheet" href="/hospital-assets/acceso.css">
</head><body>
<main class="contenedor">
  <header class="encabezado"><div class="cruz" aria-hidden="true">✚</div><div>
    <strong>Servicio Técnico</strong><span>Portal de reportes hospitalarios</span>
  </div></header>
  <section class="tarjeta" aria-labelledby="titulo">
    <p class="etiqueta">Acceso autorizado del hospital</p>
    <h1 id="titulo">${nombre}</h1>
    <p class="intro">Puedes abrir el formulario directamente o escanear el código desde otro dispositivo.</p>
    <a class="boton" href="${rutaFormulario}">Abrir formulario de reporte</a>
    <div class="separador"><span>O escanea este QR</span></div>
    <div class="qr" role="img" aria-label="Código QR del formulario de reportes">${qrSvg}</div>
    <p class="ayuda">Este QR abre el mismo formulario. Compártelo solamente con personal autorizado.</p>
  </section>
  <p class="pie">El portal no sustituye los protocolos de emergencia clínica del hospital.</p>
</main>
</body></html>`);
    } catch (error) {
      console.error('[acceso-hospital]', error?.code || error?.name || 'error');
      return res.status(500).send('No se pudo abrir el acceso del hospital.');
    }
  });
  return router;
}

module.exports = {crearRouterAccesoHospital};
