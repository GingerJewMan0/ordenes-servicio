'use strict';
/**
 * Evidencias privadas para ordenes de servicio.
 * Proyecto: ordenes-servicio-seguridad/security/evidencias.js
 *
 * DEPENDENCIAS: express, multer@2, pg y @supabase/supabase-js@2.
 * REQUIERE: SUPABASE_URL, SUPABASE_SECRET_KEY y SUPABASE_BUCKET=ordenes-evidencias.
 * NO usar SUPABASE_SECRET_KEY en React Native ni en el APK.
 *
 * Montaje previsto en server.js:
 *   const { crearRouterEvidencias } = require('./security/evidencias');
 *   app.use('/api/ordenes/:id/evidencias',
 *     crearRouterEvidencias({ pool, requerirSesion: seguridad.requerirSesion }));
 *
 * Contrato de la API (SIEMPRE requiere Bearer token valido):
 *   GET  /api/ordenes/:id/evidencias       -> metadatos, no URLs publicas
 *   POST /api/ordenes/:id/evidencias       -> multipart/form-data:
 *       archivo: imagen JPG/PNG, tipo: foto_antes | foto_despues |
 *               firma_tecnico | firma_responsable, posicion: 1..20
 *       Para firmas, posicion debe ser 1 (puede omitirse).
 *   POST /api/ordenes/:id/evidencias/finalizar -> cierre tras verificar integridad
 *   GET  /api/ordenes/:id/evidencias/:evidenciaId -> bytes protegidos
 *
 * Tabla de PostgreSQL (requiere migracion SQL previa):
 *   public.ordenes_evidencias con columnas:
 *   id uuid, orden_id integer, tipo text, posicion integer,
 *   storage_path text, mime_type text, tamano_bytes integer,
 *   sha256 text, creado_por_usuario text, creado_por_rol text,
 *   creado_en timestamptz.
 *   Requiere UNIQUE (orden_id, tipo, posicion), UNIQUE(storage_path),
 *   FK orden_id -> ordenes_servicio(id), index(orden_id).
 *
 * Las evidencias son inmutables en esta primera version: no hay API de
 * sustitucion o borrado para proteger firmas y fotografias ya emitidas.
 * Este modulo no altera el PDF ni la copia local en el dispositivo.
 */

const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const MAX_ARCHIVO_BYTES = 8 * 1024 * 1024;
const MAX_FOTOS_POR_ETAPA = 20;
const TIPOS_FOTO = new Set(['foto_antes', 'foto_despues']);
const TIPOS_FIRMA = new Set(['firma_tecnico', 'firma_responsable']);
const ROLES_PERMITIDOS = new Set(['admin', 'tecnico']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function numeroPositivo(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function tipoImagen(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length > 24 && buffer.subarray(0, 8).equals(png) &&
      buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { mime: 'image/png', extension: 'png' };
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 &&
      buffer[2] === 0xff && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}

function subirUnArchivo() {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_ARCHIVO_BYTES,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 100,
      fieldNameSize: 40
    },
    fileFilter(_req, archivo, callback) {
      if (!['image/png', 'image/jpeg', 'image/jpg'].includes(archivo.mimetype)) {
        return callback(new Error('Solo se admiten imagenes PNG o JPEG.'));
      }
      callback(null, true);
    }
  }).single('archivo');

  return (req, res, next) => {
    uploader(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const demasiadoGrande = err.code === 'LIMIT_FILE_SIZE';
        return res.status(demasiadoGrande ? 413 : 400).json({
          error: demasiadoGrande
            ? 'La imagen excede el limite de 8 MB.'
            : 'Formulario de imagen no valido.'
        });
      }
      return res.status(400).json({ error: 'Solo se admiten imagenes PNG o JPEG.' });
    });
  };
}

function crearRouterEvidencias({ pool, requerirSesion } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof requerirSesion !== 'function') {
    throw new Error('Evidencias requiere { pool, requerirSesion } del servidor actual.');
  }

  const router = express.Router({ mergeParams: true });
  let clienteSupabase = null;
  let configuracionActual = null;

  function clienteStorage() {
    const url = process.env.SUPABASE_URL;
    const secreto = process.env.SUPABASE_SECRET_KEY;
    const bucket = process.env.SUPABASE_BUCKET || 'ordenes-evidencias';
    if (!url || !secreto || bucket !== 'ordenes-evidencias') return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const identidad = `${url}\n${secreto}\n${bucket}`;
    if (!clienteSupabase || configuracionActual !== identidad) {
      clienteSupabase = createClient(url, secreto, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      configuracionActual = identidad;
    }
    return clienteSupabase.storage.from(bucket);
  }

  function fallo(res, err, contexto) {
    // Nunca registrar el cuerpo de una imagen, tokens, claves o rutas privadas.
    console.error(`[evidencias/${contexto}]`, err?.code || err?.name || 'error');
    return res.status(500).json({ error: 'No se pudo procesar la evidencia.' });
  }

  // Fallar CERRADO incluso si el backend principal esta en modo temporal sin auth.
  router.use((req, res, next) => {
    if (process.env.APP_AUTH_REQUIRED === 'false') {
      return res.status(503).json({ error: 'El respaldo requiere autenticacion activada.' });
    }
    next();
  });
  router.use(requerirSesion);
  router.use((req, res, next) => {
    if (!req.usuarioApp?.id || !ROLES_PERMITIDOS.has(req.usuarioApp.rol)) {
      return res.status(req.usuarioApp ? 403 : 401).json({ error: 'Acceso no autorizado.' });
    }
    const id = numeroPositivo(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID interno de orden invalido.' });
    req.ordenIdEvidencia = id;
    next();
  });
  router.use(async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, folio_orden FROM public.ordenes_servicio WHERE id = $1 AND eliminado_en IS NULL',
        [req.ordenIdEvidencia]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Orden no encontrada.' });
      req.ordenEvidencia = rows[0];
      next();
    } catch (err) { return fallo(res, err, 'verificar-orden'); }
  });

  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, orden_id, tipo, posicion, mime_type, tamano_bytes,
               sha256, creado_por_usuario, creado_en
        FROM public.ordenes_evidencias
        WHERE orden_id = $1
        ORDER BY tipo, posicion
      `, [req.ordenIdEvidencia]);
      res.set('Cache-Control', 'private, no-store');
      return res.json({ ordenId: req.ordenIdEvidencia, evidencias: rows });
    } catch (err) { return fallo(res, err, 'listar'); }
  });

async function autorizarCarga(req, res, next) {
  if (req.usuarioApp?.rol === 'admin') {
    return next();
  }

  if (req.usuarioApp?.rol !== 'tecnico') {
    return res.status(403).json({
      error: 'No tienes permiso para subir evidencias.'
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT usuario_creador, estado
       FROM public.ordenes_captura_evidencias
       WHERE orden_id = $1`,
      [req.ordenIdEvidencia]
    );

    const captura = rows[0];

    if (
      !captura ||
      captura.usuario_creador !== req.usuarioApp.usuario ||
      captura.estado !== 'pendiente'
    ) {
      return res.status(403).json({
        error: 'Solo puedes sincronizar las evidencias iniciales de tus propias órdenes pendientes.'
      });
    }

    return next();
  } catch (error) {
    console.error(
      '[evidencias/autorizar-carga]',
      error?.code || 'error'
    );

    return res.status(503).json({
      error: 'No se pudieron verificar los permisos.'
    });
  }
}


router.post(
  '/',
  autorizarCarga,
  subirUnArchivo(),
  async (req, res) => {
    const tipo = String(req.body?.tipo || '');
    const posicionSolicitada = String(req.body?.posicion || '');
    const esFoto = TIPOS_FOTO.has(tipo);
    const esFirma = TIPOS_FIRMA.has(tipo);
    if (!esFoto && !esFirma) {
      return res.status(400).json({ error: 'Tipo de evidencia no valido.' });
    }
    const posicion = esFirma && !posicionSolicitada ? 1 : numeroPositivo(posicionSolicitada);
    if (!posicion || (esFirma && posicion !== 1) ||
        (esFoto && posicion > MAX_FOTOS_POR_ETAPA)) {
      return res.status(400).json({ error: 'Posicion de evidencia invalida.' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Se requiere el archivo en el campo archivo.' });
    }
    const real = tipoImagen(req.file.buffer);
    if (!real || (req.file.mimetype !== real.mime &&
                   !(real.mime === 'image/jpeg' && req.file.mimetype === 'image/jpg'))) {
      return res.status(400).json({ error: 'El contenido no corresponde a una imagen PNG/JPEG valida.' });
    }
    const almacenamiento = clienteStorage();
    if (!almacenamiento) {
      return res.status(503).json({ error: 'El almacenamiento privado aun no esta configurado.' });
    }

    const id = crypto.randomUUID();
    const ruta = `ordenes/${req.ordenIdEvidencia}/${id}.${real.extension}`;
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

let subido = false;
let cliente = null;
let transaccionAbierta = false;
let commitIntentado = false;
let rollbackConfirmado = false;
let descartarCliente = false;

try {
  const { error: errorSubida } = await almacenamiento.upload(
    ruta,
    req.file.buffer,
    {
      contentType: real.mime,
      cacheControl: '0',
      upsert: false
    }
  );

  if (errorSubida) {
    console.error(
      '[evidencias/subir-storage]',
      errorSubida.name || 'error'
    );

    return res.status(502).json({
      error: 'No se pudo respaldar la imagen en Supabase.'
    });
  }

  subido = true;

  // Comenzar transaccion despues de subir el archivo.
  cliente = await pool.connect();
  await cliente.query('BEGIN');
  transaccionAbierta = true;

  // Bloquear la captura mientras verificamos y guardamos.
  // La finalizacion utiliza el mismo bloqueo FOR UPDATE.
  const { rows: capturas } = await cliente.query(
    `SELECT usuario_creador, estado
     FROM public.ordenes_captura_evidencias
     WHERE orden_id = $1
     FOR UPDATE`,
    [req.ordenIdEvidencia]
  );

  const captura = capturas[0];

  // Los tecnicos solo pueden completar su captura inicial.
  // Los administradores conservan sus permisos de gestion.
  if (
    req.usuarioApp.rol === 'tecnico' &&
    (
      !captura ||
      captura.usuario_creador !== req.usuarioApp.usuario ||
      captura.estado !== 'pendiente'
    )
  ) {
    const error = new Error('Captura no autorizada');
    error.code = 'CAPTURA_NO_AUTORIZADA';
    throw error;
  }

  // Guardar los metadatos dentro de la transaccion.
  const { rows } = await cliente.query(
    `INSERT INTO public.ordenes_evidencias
      (
        id, orden_id, tipo, posicion, storage_path,
        mime_type, tamano_bytes, sha256,
        creado_por_usuario, creado_por_rol
      )
     SELECT
       $1, o.id, $3, $4, $5, $6, $7, $8, $9, $10
     FROM public.ordenes_servicio AS o
     WHERE o.id = $2
       AND o.eliminado_en IS NULL
     RETURNING
       id, orden_id, tipo, posicion, mime_type,
       tamano_bytes, sha256, creado_por_usuario,
       creado_en`,
    [
      id,
      req.ordenIdEvidencia,
      tipo,
      posicion,
      ruta,
      real.mime,
      req.file.buffer.length,
      hash,
      req.usuarioApp.usuario,
      req.usuarioApp.rol
    ]
  );

  if (!rows[0]) {
    const error = new Error('Orden no disponible');
    error.code = 'ORDEN_NO_DISPONIBLE';
    throw error;
  }

  // A partir de aqui el resultado de COMMIT puede ser incierto si se pierde
  // la conexion mientras PostgreSQL responde. Nunca borrar Supabase en ese caso.
  commitIntentado = true;
  await cliente.query('COMMIT');
  transaccionAbierta = false;

  return res.status(201).json({
    evidencia: rows[0]
  });

} catch (err) {
  // Si el COMMIT ya se intento, NO sabemos con certeza si el registro quedo
  // confirmado. Borrar el objeto de Supabase podria dejar la BD apuntando
  // a un archivo inexistente. Se deja intacto para conciliar con el UUID.
  if (commitIntentado) {
    descartarCliente = true;
    console.error('[evidencias/commit-incierto]', id, err?.code || err?.name || 'error');
    return res.status(503).json({
      error: 'No se pudo confirmar el registro. Consulta las evidencias antes de reintentar.',
      evidenciaId: id
    });
  }

  if (cliente && transaccionAbierta) {
    try {
      await cliente.query('ROLLBACK');
      transaccionAbierta = false;
      rollbackConfirmado = true;
    } catch (errorRollback) {
      descartarCliente = true;
      console.error('[evidencias/rollback-no-confirmado]', id,
        errorRollback?.code || errorRollback?.name || 'error');
    }
  }

  // Si BEGIN fallo sin una respuesta concluyente, descartar la conexion.
  if (cliente && !transaccionAbierta && !rollbackConfirmado) {
    descartarCliente = true;
  }

  // Solo eliminar el archivo cuando es seguro que NO existe un INSERT
  // confirmado. Si ROLLBACK no pudo verificarse, priorizar no perder datos.
  if (subido && (!transaccionAbierta || rollbackConfirmado)) {
    try {
      const { error: errRetiro } = await almacenamiento.remove([ruta]);
      if (errRetiro) throw errRetiro;
    } catch (error) {
      console.error('[evidencias/limpieza-pendiente]', id,
        error?.name || 'error');
    }
  }

  if (err?.code === 'CAPTURA_NO_AUTORIZADA') {
    return res.status(403).json({
      error: 'La captura esta cerrada o no tienes permiso.'
    });
  }

  if (err?.code === '23505') {
    return res.status(409).json({
      error: 'Ya existe una evidencia en esa posicion.'
    });
  }

  if (err?.code === 'ORDEN_NO_DISPONIBLE') {
    return res.status(404).json({
      error: 'La orden ya no esta disponible.'
    });
  }

  return fallo(res, err, 'guardar-metadatos');
} finally {
  if (cliente) {
    // Ante fallos de BEGIN/ROLLBACK/COMMIT o resultado incierto,
    // no devolver una conexion dudosa al pool.
    cliente.release(descartarCliente || (!rollbackConfirmado && transaccionAbierta)
      ? new Error('Conexion con transaccion no confirmada')
      : undefined);
  }
}

  });


  // Finalizar una captura SOLO despues de verificar todos sus archivos privados.
  // El bloqueo FOR UPDATE se comparte con la ruta de subida:
  // no puede confirmarse una insercion de tecnico despues del cierre.
  // Una subida que estaba en vuelo antes del cierre puede crear temporalmente
  // un objeto remoto, que se retirara al rechazar el INSERT (salvo fallo de limpieza).
  router.post('/finalizar', async (req, res) => {
    let cliente = null;
    let transaccionAbierta = false;
    let commitIntentado = false;
    let descartarCliente = false;

    try {
      cliente = await pool.connect();
      await cliente.query('BEGIN');
      transaccionAbierta = true;

      const { rows } = await cliente.query(
        `SELECT usuario_creador, estado
         FROM public.ordenes_captura_evidencias
         WHERE orden_id = $1
         FOR UPDATE`,
        [req.ordenIdEvidencia]
      );
      const captura = rows[0];

      // Revertir antes de devolver un error: nunca dejar la fila bloqueada.
      const rechazar = async (codigo, respuesta) => {
        await cliente.query('ROLLBACK');
        transaccionAbierta = false;
        return res.status(codigo).json(respuesta);
      };

      if (!captura) {
        return await rechazar(404, {
          error: 'No existe una captura inicial para esta orden.'
        });
      }
      if (req.usuarioApp.rol !== 'admin' &&
          captura.usuario_creador !== req.usuarioApp.usuario) {
        return await rechazar(403, {
          error: 'No puedes finalizar esta captura.'
        });
      }
      if (captura.estado !== 'pendiente') {
        return await rechazar(409, {
          error: 'La captura ya fue cerrada.'
        });
      }

      const conteo = await cliente.query(
        `SELECT
           COUNT(*) FILTER (WHERE tipo = 'foto_antes')::int AS antes,
           COUNT(*) FILTER (WHERE tipo = 'foto_despues')::int AS despues,
           COUNT(*) FILTER (WHERE tipo = 'firma_tecnico')::int AS firma_tecnico,
           COUNT(*) FILTER (WHERE tipo = 'firma_responsable')::int AS firma_responsable
         FROM public.ordenes_evidencias
         WHERE orden_id = $1`,
        [req.ordenIdEvidencia]
      );
      const total = conteo.rows[0];

      if (
        total.antes < 3 ||
        total.despues < 3 ||
        total.firma_tecnico !== 1 ||
        total.firma_responsable !== 1
      ) {
        return await rechazar(409, {
          error: 'Faltan fotografias o firmas por respaldar.',
          conteo: total
        });
      }

      const almacenamiento = clienteStorage();
      if (!almacenamiento) {
        return await rechazar(503, {
          error: 'El almacenamiento privado no esta configurado.'
        });
      }

      const { rows: evidencias } = await cliente.query(
        `SELECT storage_path, mime_type, tamano_bytes, sha256
         FROM public.ordenes_evidencias
         WHERE orden_id = $1`,
        [req.ordenIdEvidencia]
      );

      // Comprobar todas las evidencias, incluso si hay mas de las 8 minimas.
      // No confiar solo en los registros de PostgreSQL: el objeto debe existir
      // en Supabase y coincidir en tamano, contenido SHA-256 y tipo real.
      for (const evidencia of evidencias) {
        let data;
        let error;
        try {
          ({ data, error } = await almacenamiento.download(evidencia.storage_path));
        } catch (errorDescarga) {
          console.error('[evidencias/verificar-storage]', errorDescarga?.name || 'error');
          return await rechazar(502, {
            error: 'No se pudieron verificar todos los archivos en Supabase.'
          });
        }
        if (error || !data) {
          console.error('[evidencias/verificar-storage]', error?.name || 'error');
          return await rechazar(502, {
            error: 'No se pudieron verificar todos los archivos en Supabase.'
          });
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        const mimeReal = tipoImagen(buffer)?.mime;
        const hashReal = crypto.createHash('sha256').update(buffer).digest('hex');
        if (
          buffer.length > MAX_ARCHIVO_BYTES ||
          buffer.length !== Number(evidencia.tamano_bytes) ||
          hashReal !== evidencia.sha256 ||
          mimeReal !== evidencia.mime_type
        ) {
          return await rechazar(502, {
            error: 'Una evidencia no coincide con su registro de integridad.'
          });
        }
      }

      await cliente.query(
        `UPDATE public.ordenes_captura_evidencias
         SET estado = 'cerrada', cerrada_en = NOW()
         WHERE orden_id = $1 AND estado = 'pendiente'`,
        [req.ordenIdEvidencia]
      );
      commitIntentado = true;
      await cliente.query('COMMIT');
      transaccionAbierta = false;

      return res.json({
        capturaCerrada: true,
        ordenId: req.ordenIdEvidencia,
        evidenciasVerificadas: evidencias.length
      });
    } catch (error) {
      if (commitIntentado) {
        descartarCliente = true;
        // El COMMIT pudo confirmarse aunque la respuesta se haya perdido.
        // Nunca afirmar que la captura sigue pendiente sin volver a consultarla.
        console.error('[evidencias/finalizar-commit-incierto]',
          req.ordenIdEvidencia, error?.code || error?.name || 'error');
        return res.status(503).json({
          error: 'No se pudo confirmar el cierre. Consulta el estado antes de reintentar.',
          ordenId: req.ordenIdEvidencia
        });
      }
      if (cliente && transaccionAbierta) {
        try {
          await cliente.query('ROLLBACK');
        } catch (_) {
          descartarCliente = true;
        }
      } else if (cliente) {
        // Podria haberse iniciado BEGIN aunque la respuesta se haya perdido.
        descartarCliente = true;
      }
      return fallo(res, error, 'finalizar-captura');
    } finally {
      if (cliente) cliente.release(descartarCliente
        ? new Error('Conexion con transaccion no confirmada')
        : undefined);
    }
  });

  router.get('/:evidenciaId', async (req, res) => {
    if (!UUID_RE.test(String(req.params.evidenciaId))) {
      return res.status(400).json({ error: 'Identificador de evidencia invalido.' });
    }
    try {
      const { rows } = await pool.query(`
        SELECT id, storage_path, mime_type, tamano_bytes, sha256
        FROM public.ordenes_evidencias
        WHERE id = $1 AND orden_id = $2
        LIMIT 1
      `, [req.params.evidenciaId, req.ordenIdEvidencia]);
      const evidencia = rows[0];
      if (!evidencia) return res.status(404).json({ error: 'Evidencia no encontrada.' });
      const almacenamiento = clienteStorage();
      if (!almacenamiento) {
        return res.status(503).json({ error: 'El almacenamiento privado aun no esta configurado.' });
      }
      const { data, error } = await almacenamiento.download(evidencia.storage_path);
      if (error || !data) {
        console.error('[evidencias/descargar-storage]', error?.name || 'error');
        return res.status(502).json({ error: 'No se pudo recuperar la evidencia.' });
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      if (buffer.length > MAX_ARCHIVO_BYTES || buffer.length !== Number(evidencia.tamano_bytes)) {
        return res.status(502).json({ error: 'El archivo recuperado no coincide con el registro.' });
      }
      const hashReal = crypto.createHash('sha256').update(buffer).digest('hex');
      if (hashReal !== evidencia.sha256) {
        return res.status(502).json({ error: 'La integridad de la evidencia no pudo verificarse.' });
      }
      const real = tipoImagen(buffer);
      if (!real || real.mime !== evidencia.mime_type) {
        return res.status(502).json({ error: 'El formato del archivo recuperado es incorrecto.' });
      }
      res.set({
        'Content-Type': evidencia.mime_type,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="evidencia-${evidencia.id}.${real.extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(buffer);
    } catch (err) { return fallo(res, err, 'descargar'); }
  });

  return router;
}

module.exports = { crearRouterEvidencias };