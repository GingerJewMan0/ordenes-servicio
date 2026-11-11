-- ALTERA BASE DE DATOS. Ejecutar UNA SOLA VEZ, después de revisar 01.
-- Se espera que las cuatro órdenes identificadas sean pruebas, como indicó el usuario.
-- No toca public.equipos ni borra registros distintos de (id, folio) confirmados.
-- Hace respaldo completo antes de borrar. Si surge un error, se revierte la transacción.

BEGIN;
LOCK TABLE public.ordenes_servicio IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  numero_ids integer;
  numero_coinciden integer;
BEGIN
  SELECT count(*) INTO numero_ids
  FROM public.ordenes_servicio WHERE id IN (1, 2, 7, 8);

  SELECT count(*) INTO numero_coinciden
  FROM public.ordenes_servicio
  WHERE (id=1 AND folio_orden=1001)
     OR (id=2 AND folio_orden=1002)
     OR (id=7 AND folio_orden=1005)
     OR (id=8 AND folio_orden=0);

  IF numero_ids <> 4 OR numero_coinciden <> 4 THEN
    RAISE EXCEPTION 'Las 4 pruebas cambiaron. No se borró nada. Revisa el SQL 01.';
  END IF;
END $$;

-- Conserva todas las columnas y filas previas, incluso pruebas, por si hay que revisar.
-- El nombre fijo evita ejecutar accidentalmente esta limpieza dos veces.
CREATE TABLE public.ordenes_servicio_respaldo_pruebas_20261111
AS TABLE public.ordenes_servicio WITH DATA;

DELETE FROM public.ordenes_servicio
WHERE (id=1 AND folio_orden=1001)
   OR (id=2 AND folio_orden=1002)
   OR (id=7 AND folio_orden=1005)
   OR (id=8 AND folio_orden=0);

-- Serie oficial de las ÓRDENES. No se confunde con viáticos V-0001...
CREATE SEQUENCE IF NOT EXISTS public.ordenes_servicio_folio_seq START WITH 1001 INCREMENT BY 1;
SELECT setval(
  'public.ordenes_servicio_folio_seq'::regclass,
  GREATEST(1000, COALESCE((SELECT max(folio_orden) FROM public.ordenes_servicio),1000)),
  true
);
ALTER SEQUENCE public.ordenes_servicio_folio_seq OWNED BY public.ordenes_servicio.folio_orden;

-- IMPORTANTE: usar solo el trigger. Un DEFAULT nextval() también consumiría
-- un valor extra en cada INSERT, produciendo saltos innecesarios.
ALTER TABLE public.ordenes_servicio ALTER COLUMN folio_orden DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.asignar_folio_orden_automatico()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Reemplaza cualquier valor enviado por el cliente, incluido 0, NULL o uno manual.
  NEW.folio_orden := nextval('public.ordenes_servicio_folio_seq'::regclass);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_folio_orden_automatico ON public.ordenes_servicio;
CREATE TRIGGER trg_folio_orden_automatico
BEFORE INSERT ON public.ordenes_servicio
FOR EACH ROW EXECUTE FUNCTION public.asignar_folio_orden_automatico();

-- Evita folios duplicados. Si hay un duplicado entre otras órdenes reales,
-- se abortará todo; revisa los resultados de la consulta 01.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ordenes_servicio_folio_orden
ON public.ordenes_servicio(folio_orden);

COMMIT;

-- Comprobación después de COMMIT (estas consultas no insertan datos ni gastan folios):
SELECT id, folio_orden, nombre_unidad_medica
FROM public.ordenes_servicio ORDER BY id;
SELECT last_value, is_called FROM public.ordenes_servicio_folio_seq;
SELECT count(*) AS ordenes_respaldadas FROM public.ordenes_servicio_respaldo_pruebas_20261111;

-- El backend sigue debiendo responder al POST con la fila insertada:
-- INSERT ... RETURNING id, folio_orden;
-- A falta de backend, el código Android consulta el GET por el ID devuelto.
-- Si el POST no devuelve ni ID ni folio, el PDF se bloqueará para no inventar uno.
