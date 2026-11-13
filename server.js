const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { crearSeguridad } = require('./security/sesiones');
const { registrarAuditoria } = require('./security/auditoria');

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
    const result = await pool.query('SELECT * FROM public.ordenes_servicio WHERE eliminado_en IS NULL ORDER BY folio_orden DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al obtener las órdenes de servicio');
  }
});


// Campos presentes en la tabla actual. Nunca permitir editar id, folio, fecha ni eliminado_en.
const CAMPOS_EDITABLES = Object.freeze([
  'empresa', 'motivo_servicio', 'nombre_unidad_medica', 'direccion',
  'ubicacion', 'contacto', 'no_contrato', 'tel_unidad', 'tel_responsable',
  'tiempo_garantia', 'equipo', 'marca', 'modelo', 'serie', 'inventario',
  'observaciones', 'observaciones_mtto_correctivo', 'tecnico_servicio',
  'responsable_unidad'
]);
const CAMPOS_PERMITIDOS = new Set(CAMPOS_EDITABLES);

function idValido(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({error: 'Identificador de orden inválido.'});
  }
  req.ordenId = id;
  next();
}

async function cancelarSilenciosamente(cliente) {
  if (cliente) await cliente.query('ROLLBACK').catch(() => {});
}

function errorOrden(res, err, operacion) {
  console.error(`[ordenes/${operacion}]`, err?.code || err?.message || err);
  if (err?.code === '23505') return res.status(409).json({error: 'Ya existe una orden con ese folio.'});
  return res.status(500).json({error: 'No se pudo completar la operación de órdenes.'});
}

// Consultar una orden por su ID de PostgreSQL (no por el folio visible).
app.get('/api/ordenes/:id', idValido, async (req, res) => {
  try {
    const {rows} = await pool.query(
      'SELECT * FROM public.ordenes_servicio WHERE id = $1 AND eliminado_en IS NULL',
      [req.ordenId]
    );
    if (!rows[0]) return res.status(404).json({error: 'Orden no encontrada.'});
    return res.json(rows[0]);
  } catch (err) { return errorOrden(res, err, 'detalle'); }
});

// Crear orden: conservar el trigger de folio automático y auditar en la misma transacción.
app.post('/api/ordenes', async (req, res) => {
  const {
    empresa, folio_orden, motivo_servicio, nombre_unidad_medica, direccion,
    ubicacion, contacto, no_contrato, tel_unidad, tel_responsable,
    tiempo_garantia, equipo, marca, modelo, serie, inventario,
    observaciones, observaciones_mtto_correctivo, tecnico_servicio, responsable_unidad
  } = req.body || {};
  let cliente;
  try {
    cliente = await pool.connect();
    await cliente.query('BEGIN');
    const query = `
      INSERT INTO public.ordenes_servicio (
        empresa, folio_orden, motivo_servicio, nombre_unidad_medica, direccion,
        ubicacion, contacto, no_contrato, tel_unidad, tel_responsable,
        tiempo_garantia, equipo, marca, modelo, serie, inventario,
        observaciones, observaciones_mtto_correctivo, tecnico_servicio, responsable_unidad, fecha
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
      RETURNING *`;
    const values = [
      empresa || 'Mexus Hospitalaria, S.A. de C.V.', folio_orden, motivo_servicio,
      nombre_unidad_medica, direccion, ubicacion, contacto, no_contrato,
      tel_unidad, tel_responsable, tiempo_garantia, equipo, marca, modelo,
      serie, inventario, observaciones, observaciones_mtto_correctivo,
      tecnico_servicio, responsable_unidad
    ];
    const {rows} = await cliente.query(query, values);
    await registrarAuditoria(cliente, req, {
      modulo: 'ordenes', accion: 'crear', registroId: rows[0].id,
      folio: rows[0].folio_orden
    });
    await cliente.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (err) {
    await cancelarSilenciosamente(cliente);
    return errorOrden(res, err, 'crear');
  } finally { cliente?.release(); }
});

// Editar orden existente. Técnico y administrador, ambos autenticados.
// Acepta campos parciales sin alterar folio_orden ni fecha original.
async function editarOrden(req, res) {
  const cuerpo = req.body;
  if (!cuerpo || Array.isArray(cuerpo) || typeof cuerpo !== 'object') {
    return res.status(400).json({error: 'Envía un objeto JSON válido.'});
  }
  const campos = Object.keys(cuerpo);
  if (!campos.length || campos.some(campo => !CAMPOS_PERMITIDOS.has(campo))) {
    return res.status(400).json({error: 'La solicitud incluye campos vacíos o no editables. El folio y el ID no se modifican.'});
  }
  if (campos.some(campo => cuerpo[campo] !== null &&
      (typeof cuerpo[campo] !== 'string' || cuerpo[campo].length > 10000))) {
    return res.status(400).json({error: 'Los campos de la orden deben ser texto o NULL.'});
  }
  let cliente;
  try {
    cliente = await pool.connect();
    await cliente.query('BEGIN');
    const {rows: existentes} = await cliente.query(
      'SELECT id, folio_orden FROM public.ordenes_servicio WHERE id = $1 AND eliminado_en IS NULL FOR UPDATE',
      [req.ordenId]
    );
    if (!existentes[0]) {
      await cliente.query('ROLLBACK');
      return res.status(404).json({error: 'Orden no encontrada o eliminada.'});
    }
    const asignaciones = campos.map((campo, i) => `"${campo}" = $${i+1}`).join(', ');
    const values = campos.map(campo => cuerpo[campo]);
    const {rows} = await cliente.query(
      `UPDATE public.ordenes_servicio SET ${asignaciones} WHERE id = $${campos.length+1} RETURNING *`,
      [...values, req.ordenId]
    );
    await registrarAuditoria(cliente, req, {
      modulo: 'ordenes', accion: 'editar', registroId: rows[0].id,
      folio: rows[0].folio_orden
    });
    await cliente.query('COMMIT');
    return res.json(rows[0]);
  } catch (err) {
    await cancelarSilenciosamente(cliente);
    return errorOrden(res, err, 'editar');
  } finally { cliente?.release(); }
}
app.put('/api/ordenes/:id', idValido, editarOrden);
app.patch('/api/ordenes/:id', idValido, editarOrden);

// Eliminación lógica e irreversible desde esta API: solo admin.
// Los datos permanecen en PostgreSQL para auditoría y posible recuperación administrativa.
function exigirAdministrador(req, res, next) {
  if (!req.usuarioApp) return res.status(401).json({error: 'Inicia sesión para continuar.'});
  if (req.usuarioApp.rol !== 'admin') {
    return res.status(403).json({error: 'Solo un administrador puede eliminar órdenes.'});
  }
  next();
}
app.delete('/api/ordenes/:id', idValido, exigirAdministrador, async (req, res) => {
  let cliente;
  try {
    cliente = await pool.connect();
    await cliente.query('BEGIN');
    const {rows} = await cliente.query(
      'UPDATE public.ordenes_servicio SET eliminado_en = NOW() WHERE id = $1 AND eliminado_en IS NULL RETURNING id, folio_orden',
      [req.ordenId]
    );
    if (!rows[0]) {
      await cliente.query('ROLLBACK');
      return res.status(404).json({error: 'Orden no encontrada o ya eliminada.'});
    }
    await registrarAuditoria(cliente, req, {
      modulo: 'ordenes', accion: 'eliminar', registroId: rows[0].id,
      folio: rows[0].folio_orden
    });
    await cliente.query('COMMIT');
    return res.json({eliminada: true, id: rows[0].id, folio_orden: rows[0].folio_orden});
  } catch (err) {
    await cancelarSilenciosamente(cliente);
    return errorOrden(res, err, 'eliminar');
  } finally { cliente?.release(); }
});

app.listen(port, () => {
  console.log(`Servidor de órdenes corriendo en el puerto ${port}`);
});