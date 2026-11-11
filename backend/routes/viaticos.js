// Montar este router EN EL BACKEND de Express que ya atiende /api/ordenes.
// No es un servidor nuevo. Recibe un Pool de 'pg' configurado por el backend.
const express = require('express');

const RUBROS = ['casetas', 'estacionamiento', 'gasolina', 'hospedaje', 'comida', 'refacciones', 'material', 'otros'];
const CAMPOS = ['empresa_id', 'empleado', 'destino', 'fecha_inicio', 'fecha_fin', 'orden_relacionada',
  'motivo', 'observaciones', ...RUBROS];
const COLUMNAS = [
  'id', 'folio', 'client_request_id', ...CAMPOS, 'total', 'creado_en', 'actualizado_en', 'eliminado_en'
].join(', ');

function validar(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new Error('Datos de viáticos inválidos.');
  const texto = (v, max) => String(v ?? '').trim().slice(0, max);
  const datos = {
    empresa_id: texto(cuerpo.empresaId, 30),
    empleado: texto(cuerpo.empleado, 180),
    destino: texto(cuerpo.destino, 250),
    fecha_inicio: texto(cuerpo.fechaInicio, 10),
    fecha_fin: texto(cuerpo.fechaFin, 10),
    orden_relacionada: texto(cuerpo.ordenRelacionada, 50),
    motivo: texto(cuerpo.motivo, 4000),
    observaciones: texto(cuerpo.observaciones, 4000)
  };
  if (!['opciones', 'mexus'].includes(datos.empresa_id)) throw new Error('Empresa inválida.');
  if (!datos.empleado || !datos.destino || !datos.motivo) throw new Error('Completa empleado, destino y motivo.');
  const esFecha = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const fecha = new Date(`${v}T12:00:00.000Z`);
    return !Number.isNaN(fecha.valueOf()) && fecha.toISOString().slice(0,10) === v;
  };
  if (!esFecha(datos.fecha_inicio) || !esFecha(datos.fecha_fin) || datos.fecha_fin < datos.fecha_inicio) {
    throw new Error('Fechas inválidas o fuera de orden.');
  }
  for (const rubro of RUBROS) {
    const n = Number(cuerpo.gastos?.[rubro] ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 9999999999.99 || Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-7) {
      throw new Error(`Importe inválido: ${rubro}.`);
    }
    datos[rubro] = n.toFixed(2);
  }
  return datos;
}

function presentar(fila) {
  return {
    id: String(fila.id), folio: fila.folio,
    empresaId: fila.empresa_id, empleado: fila.empleado, destino: fila.destino,
    fechaInicio: fila.fecha_inicio instanceof Date ? fila.fecha_inicio.toISOString().slice(0, 10) : String(fila.fecha_inicio).slice(0, 10),
    fechaFin: fila.fecha_fin instanceof Date ? fila.fecha_fin.toISOString().slice(0, 10) : String(fila.fecha_fin).slice(0, 10),
    ordenRelacionada: fila.orden_relacionada,
    motivo: fila.motivo, observaciones: fila.observaciones,
    gastos: Object.fromEntries(RUBROS.map((nombre) => [nombre, Number(fila[nombre])])),
    total: Number(fila.total), creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en, origen: 'servidor'
  };
}

module.exports = function crearRouterViaticos(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('Se necesita el Pool de PostgreSQL existente.');
  const router = express.Router();
  router.use(express.json({ limit: '100kb' }));

  function errorHTTP(res, error) {
    if (error?.message?.startsWith('Datos') || error?.message?.startsWith('Completa') ||
        error?.message?.startsWith('Empresa') || error?.message?.startsWith('Fechas') ||
        error?.message?.startsWith('Importe')) return res.status(400).json({ error: error.message });
    if (error?.code === '23505') return res.status(409).json({ error: 'Folio o identificador duplicado.' });
    if (error?.code === '42P01') return res.status(503).json({ error: 'Falta crear la tabla viaticos en PostgreSQL.' });
    console.error('Error en viáticos:', error);
    return res.status(500).json({ error: 'Error de servidor al guardar o consultar viáticos.' });
  }

  router.get('/', async (_req, res) => {
    try {
      const { rows } = await pool.query(`SELECT ${COLUMNAS} FROM public.viaticos
        WHERE eliminado_en IS NULL ORDER BY creado_en DESC, id DESC LIMIT 200`);
      res.json({ viaticos: rows.map(presentar) });
    } catch (error) { errorHTTP(res, error); }
  });

  router.post('/', async (req, res) => {
    try {
      const datos = validar(req.body);
      const idPeticion = String(req.body.clientRequestId ?? '');
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(idPeticion)) {
        return res.status(400).json({ error: 'Identificador de solicitud inválido.' });
      }
      const columnas = ['client_request_id', ...CAMPOS];
      const valores = [idPeticion, ...CAMPOS.map((c) => datos[c])];
      const placeholders = valores.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await pool.query(`INSERT INTO public.viaticos (${columnas.join(', ')})
        VALUES (${placeholders}) ON CONFLICT (client_request_id) DO NOTHING
        RETURNING ${COLUMNAS}`, valores);
      if (rows.length) return res.status(201).json({ viatico: presentar(rows[0]) });
      const existente = await pool.query(`SELECT ${COLUMNAS} FROM public.viaticos
        WHERE client_request_id = $1`, [idPeticion]);
      if (!existente.rows.length || existente.rows[0].eliminado_en) {
        return res.status(409).json({ error: 'Solicitud duplicada previamente eliminada.' });
      }
      return res.status(200).json({ viatico: presentar(existente.rows[0]), repetido: true });
    } catch (error) { errorHTTP(res, error); }
  });

  router.put('/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Identificador inválido.' });
      const datos = validar(req.body);
      const parametros = CAMPOS.map((campo) => datos[campo]);
      const asignaciones = CAMPOS.map((campo, i) => `${campo}=$${i + 1}`).join(', ');
      const { rows } = await pool.query(`UPDATE public.viaticos SET ${asignaciones}, actualizado_en=now()
        WHERE id=$${parametros.length + 1} AND eliminado_en IS NULL RETURNING ${COLUMNAS}`,
        [...parametros, id]);
      if (!rows.length) return res.status(404).json({ error: 'Viático no encontrado.' });
      res.json({ viatico: presentar(rows[0]) });
    } catch (error) { errorHTTP(res, error); }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Identificador inválido.' });
      const { rows } = await pool.query(`UPDATE public.viaticos
        SET eliminado_en=now(), actualizado_en=now()
        WHERE id=$1 AND eliminado_en IS NULL RETURNING id, folio`, [id]);
      if (!rows.length) return res.status(404).json({ error: 'Viático no encontrado.' });
      res.json({ eliminado: true, folio: rows[0].folio });
    } catch (error) { errorHTTP(res, error); }
  });
  return router;
};
