-- MIGRACIÓN ADITIVA: no borra ni modifica los viáticos existentes.
-- Ejecutar SOLAMENTE en la base de datos utilizada por ordenes-viaticos-test.
-- REQUIERE public.viaticos(id BIGINT) y public.app_auditoria existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.viaticos_captura_comprobantes (
  viatico_id bigint PRIMARY KEY REFERENCES public.viaticos(id) ON DELETE RESTRICT,
  usuario_creador varchar(80) NOT NULL,
  estado varchar(20) NOT NULL DEFAULT 'pendiente',
  creada_en timestamptz NOT NULL DEFAULT now(),
  cerrada_en timestamptz,
  CONSTRAINT viaticos_captura_estado_ck CHECK (
     (estado='pendiente' AND cerrada_en IS NULL) OR
     (estado='cerrada' AND cerrada_en IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.viaticos_comprobantes (
  id uuid PRIMARY KEY,
  viatico_id bigint NOT NULL REFERENCES public.viaticos(id) ON DELETE RESTRICT,
  client_id varchar(100),
  fecha date NOT NULL,
  concepto varchar(20) NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type varchar(20) NOT NULL,
  tamano_bytes integer NOT NULL,
  sha256 char(64) NOT NULL,
  creado_por_usuario varchar(80) NOT NULL,
  creado_por_rol varchar(20) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  estado varchar(20) NOT NULL DEFAULT 'vigente',
  reemplaza_id uuid REFERENCES public.viaticos_comprobantes(id),
  cambiado_por_usuario varchar(80),
  cambiado_en timestamptz,
  CONSTRAINT viaticos_comprobantes_concepto_ck CHECK (concepto IN
     ('casetas','estacionamiento','gasolina','hospedaje','comida','refacciones','material','otros')),
  CONSTRAINT viaticos_comprobantes_mime_ck CHECK (mime_type IN ('image/jpeg','image/png')),
  CONSTRAINT viaticos_comprobantes_tamano_ck CHECK (tamano_bytes BETWEEN 1 AND 8388608),
  CONSTRAINT viaticos_comprobantes_sha_ck CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT viaticos_comprobantes_estado_ck CHECK (estado IN ('vigente','reemplazado','eliminado')),
  CONSTRAINT viaticos_comprobantes_creador_rol_ck CHECK (creado_por_rol IN ('admin','tecnico'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_viaticos_comprobantes_cliente
  ON public.viaticos_comprobantes (viatico_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_viaticos_comprobantes_viatico
  ON public.viaticos_comprobantes(viatico_id, estado);
COMMIT;
