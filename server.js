const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { crearSeguridad } = require('./security/sesiones');

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Los dos servicios comparten las tablas app_usuarios y app_sesiones
// del mismo PostgreSQL. Dejar false durante las pruebas de migracion.
// Con APP_AUTH_REQUIRED=true se exigira Bearer token en las rutas.
app.set('trust proxy', 1); // Render usa un proxy inverso.
const seguridad = crearSeguridad(pool);
app.use('/api/auth', seguridad.router);
app.use('/api/ordenes', seguridad.requerirSesion);


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

app.listen(port, () => {
  console.log(`Servidor de órdenes corriendo en el puerto ${port}`);
});