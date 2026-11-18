-- Table: public.ordenes_evidencias

-- DROP TABLE IF EXISTS public.ordenes_evidencias;

CREATE TABLE IF NOT EXISTS public.ordenes_evidencias
(
    id uuid NOT NULL,
    orden_id integer NOT NULL,
    tipo text COLLATE pg_catalog."default" NOT NULL,
    posicion integer NOT NULL,
    storage_path text COLLATE pg_catalog."default" NOT NULL,
    mime_type text COLLATE pg_catalog."default" NOT NULL,
    tamano_bytes integer NOT NULL,
    sha256 text COLLATE pg_catalog."default" NOT NULL,
    creado_por_usuario text COLLATE pg_catalog."default" NOT NULL,
    creado_por_rol text COLLATE pg_catalog."default" NOT NULL,
    creado_en timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ordenes_evidencias_pkey PRIMARY KEY (id),
    CONSTRAINT evidencias_posicion_unica UNIQUE (orden_id, tipo, posicion),
    CONSTRAINT ordenes_evidencias_storage_path_key UNIQUE (storage_path),
    CONSTRAINT ordenes_evidencias_orden_id_fkey FOREIGN KEY (orden_id)
        REFERENCES public.ordenes_servicio (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE RESTRICT,
    CONSTRAINT evidencias_posicion_valida CHECK ((tipo = ANY (ARRAY['foto_antes'::text, 'foto_despues'::text])) AND posicion >= 1 AND posicion <= 20 OR (tipo = ANY (ARRAY['firma_tecnico'::text, 'firma_responsable'::text])) AND posicion = 1),
    CONSTRAINT ordenes_evidencias_creado_por_rol_check CHECK (creado_por_rol = ANY (ARRAY['admin'::text, 'tecnico'::text])),
    CONSTRAINT ordenes_evidencias_mime_type_check CHECK (mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text])),
    CONSTRAINT ordenes_evidencias_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'::text),
    CONSTRAINT ordenes_evidencias_tamano_bytes_check CHECK (tamano_bytes >= 1 AND tamano_bytes <= 8388608),
    CONSTRAINT ordenes_evidencias_tipo_check CHECK (tipo = ANY (ARRAY['foto_antes'::text, 'foto_despues'::text, 'firma_tecnico'::text, 'firma_responsable'::text]))
)

TABLESPACE pg_default;
-- Index: idx_evidencias_orden

-- DROP INDEX IF EXISTS public.idx_evidencias_orden;

CREATE INDEX IF NOT EXISTS idx_evidencias_orden
    ON public.ordenes_evidencias USING btree
    (orden_id ASC NULLS LAST)
;