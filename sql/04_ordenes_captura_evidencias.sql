-- Table: public.ordenes_captura_evidencias

-- DROP TABLE IF EXISTS public.ordenes_captura_evidencias;

CREATE TABLE IF NOT EXISTS public.ordenes_captura_evidencias
(
    orden_id integer NOT NULL,
    usuario_creador character varying(80) COLLATE pg_catalog."default" NOT NULL,
    estado character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pendiente'::character varying,
    creada_en timestamp with time zone NOT NULL DEFAULT now(),
    cerrada_en timestamp with time zone,
    CONSTRAINT ordenes_captura_evidencias_pkey PRIMARY KEY (orden_id),
    CONSTRAINT ordenes_captura_evidencias_orden_id_fkey FOREIGN KEY (orden_id)
        REFERENCES public.ordenes_servicio (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT captura_estado_consistente CHECK (estado::text = 'pendiente'::text AND cerrada_en IS NULL OR estado::text = 'cerrada'::text AND cerrada_en IS NOT NULL),
    CONSTRAINT ordenes_captura_evidencias_estado_check CHECK (estado::text = ANY (ARRAY['pendiente'::character varying, 'cerrada'::character varying]::text[]))
)

TABLESPACE pg_default;