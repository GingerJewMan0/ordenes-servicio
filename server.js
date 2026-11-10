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