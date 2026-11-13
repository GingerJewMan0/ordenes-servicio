// Prueba de estructura offline. No conecta a base de datos ni realiza peticiones.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const file = fs.readFileSync(require('node:path').join(__dirname,'..','server.js'),'utf8');
for (const s of [
  "app.use('/api/ordenes', seguridad.requerirSesion)",
  "app.put('/api/ordenes/:id'",
  "app.patch('/api/ordenes/:id'",
  "app.delete('/api/ordenes/:id', idValido, exigirAdministrador",
  "modulo: 'ordenes', accion: 'crear'",
  "modulo: 'ordenes', accion: 'editar'",
  "modulo: 'ordenes', accion: 'eliminar'",
  'eliminado_en IS NULL',
  "cliente.query('BEGIN')",
  'registrarAuditoria(cliente, req',
]) assert.ok(file.includes(s), `Falta: ${s}`);
console.log('OK: rutas protegidas, edición, eliminación solo admin, auditoría y eliminación lógica (verificación estática).');
