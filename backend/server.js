const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crearRouterViaticos = require('./routes/viaticos');
const crearRouterComprobantesViaticos = require('./routes/comprobantesViaticos');
const { crearSeguridad } = require('./security/sesiones');
const { crearRouterAdminUsuarios } = require('./routes/adminUsuarios');
const { crearRouterReportesHospitalarios } = require('./routes/reportesHospitalarios');
const { crearRouterAccesoHospital } = require('./routes/accesoHospital');
const { crearRouterAsignacionesHospitalarias } = require('./routes/asignacionesHospitalarias');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Web de reportes hospitalarios: el QR identifica al hospital para CREAR reportes.
// Las funciones de administración siguen protegidas por sesión y rol.
app.use('/hospital-assets', express.static(path.join(__dirname, 'public', 'hospital'), {
  index: false,
  fallthrough: false,
  setHeaders(res) { res.setHeader('Referrer-Policy', 'no-referrer'); }
}));
app.get('/hospital/:token', (req, res) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.token)) {
    return res.status(404).send('Enlace inválido.');
  }
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'");
  return res.sendFile(path.join(__dirname, 'public', 'hospital', 'index.html'));
});
app.use('/acceso', crearRouterAccesoHospital(pool));

// Login y permisos. Montar ANTES de las rutas de órdenes y viáticos.
// TRANSICIÓN: APP_AUTH_REQUIRED=false mantiene los APK actuales funcionando.
// PRODUCCIÓN: activar true solamente cuando ambos servicios y teléfonos estén actualizados.
app.set('trust proxy', 1); // Render: acceso desde un proxy inverso.
const seguridad = crearSeguridad(pool);
app.use('/api/auth', seguridad.router);
// Reportes hospitalarios: para ADMIN usar verificación OBLIGATORIA de sesión,
// aunque APP_AUTH_REQUIRED=false mantenga accesibles algunos APK antiguos.
app.use('/api/reportes-hospitalarios', crearRouterReportesHospitalarios({
  pool,
  requerirSesion: seguridad.verificarSesionSiempre
}));
app.use('/api/reportes-asignaciones', crearRouterAsignacionesHospitalarias(pool, seguridad.verificarSesionSiempre));
// Administración protegida SIEMPRE: requiere token y rol admin aunque otras
// rutas se encuentren temporalmente con APP_AUTH_REQUIRED=false.
app.use('/api/admin/usuarios', seguridad.verificarSesionSiempre, crearRouterAdminUsuarios(pool));
app.use('/api/ordenes', seguridad.requerirSesion);
app.use('/api/viaticos', seguridad.requerirSesion);
// Edición y eliminación de viáticos: únicamente administrador, SIEMPRE.
// No depender de APP_AUTH_REQUIRED para estas mutaciones.
const exigirAdminViaticos = (req, res, next) => {
  if (!req.usuarioApp) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  if (req.usuarioApp.rol !== 'admin') return res.status(403).json({ error: 'Esta acción requiere una cuenta administradora.' });
  return next();
};
app.put('/api/viaticos/:id', exigirAdminViaticos);
app.patch('/api/viaticos/:id', exigirAdminViaticos);
app.delete('/api/viaticos/:id', exigirAdminViaticos);

// Obtener todas las órdenes de servicio
app.get('/api/ordenes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ordenes_servicio ORDER BY folio_orden DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al obtener las órdenes de servicio');
  }
});

// Crear una nueva orden de servicio (incluyendo empresa)
app.post('/api/ordenes', async (req, res) => {
  const {
    empresa, folio_orden, motivo_servicio, nombre_unidad_medica, direccion,
    ubicacion, contacto, no_contrato, tel_unidad, tel_responsable,
    tiempo_garantia, equipo, marca, modelo, serie, inventario,
    observaciones, observaciones_mtto_correctivo, tecnico_servicio, responsable_unidad
  } = req.body;

  try {
    const query = `
      INSERT INTO ordenes_servicio (
        empresa, folio_orden, motivo_servicio, nombre_unidad_medica, direccion,
        ubicacion, contacto, no_contrato, tel_unidad, tel_responsable,
        tiempo_garantia, equipo, marca, modelo, serie, inventario,
        observaciones, observaciones_mtto_correctivo, tecnico_servicio, responsable_unidad, fecha
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
      RETURNING *;
    `;
    const values = [
      empresa || 'Mexus Hospitalaria, S.A. de C.V.', folio_orden, motivo_servicio, nombre_unidad_medica, direccion,
      ubicacion, contacto, no_contrato, tel_unidad, tel_responsable,
      tiempo_garantia, equipo, marca, modelo, serie, inventario,
      observaciones, observaciones_mtto_correctivo, tecnico_servicio, responsable_unidad
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El número de folio ya existe.' });
    }
    res.status(500).send('Error al registrar la orden de servicio');
  }
});

// Comprobantes privados: siempre exige una sesión y aplica permisos por archivo.
app.use('/api/viaticos/:id/comprobantes', crearRouterComprobantesViaticos(pool));

// Viáticos: usa el mismo Pool de PostgreSQL, en una tabla independiente.
app.use('/api/viaticos', crearRouterViaticos(pool));

app.listen(port, () => {
  console.log(`Servidor de órdenes corriendo en el puerto ${port}`);
});