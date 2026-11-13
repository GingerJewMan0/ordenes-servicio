'use strict';
// Auditoría mínima: no registrar cuerpos de solicitudes, contraseñas, tokens ni fotos.
// Debe ejecutarse con el mismo cliente y dentro del BEGIN/COMMIT del cambio real.
const MODULOS = new Set(['ordenes', 'viaticos', 'usuarios', 'equipos']);
const ACCIONES = new Set(['crear', 'editar', 'eliminar', 'activar', 'desactivar', 'cambiar_clave']);

async function registrarAuditoria(client, req, {modulo, accion, registroId = null, folio = null}) {
  const actor = req?.usuarioApp;
  if (!actor?.id || !actor?.usuario || !actor?.rol) {
    const error = new Error('Se requiere una sesión válida para registrar cambios.');
    error.status = 401;
    throw error;
  }
  if (!MODULOS.has(modulo) || !ACCIONES.has(accion)) {
    throw new Error('Acción de auditoría no permitida.');
  }
  await client.query(`
    INSERT INTO public.app_auditoria
      (usuario_id, usuario, rol, modulo, accion, registro_id, folio)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [String(actor.id), actor.usuario, actor.rol, modulo, accion,
      registroId == null ? null : String(registroId),
      folio == null ? null : String(folio)]);
}

module.exports = {registrarAuditoria};
