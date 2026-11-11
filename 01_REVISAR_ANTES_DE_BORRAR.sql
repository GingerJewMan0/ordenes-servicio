-- SOLO CONSULTA. Ejecutar primero en pgAdmin -> Query Tool.
-- Comprueba que estás conectado a la BD de Render correcta.
SELECT current_database() AS base_actual, current_user AS usuario_actual;

SELECT id, folio_orden, nombre_unidad_medica, motivo_servicio, fecha
FROM public.ordenes_servicio
ORDER BY id;

-- EXACTAMENTE ESTOS CUATRO REGISTROS eran las pruebas observadas.
-- Si ya no coinciden, no ejecutes el script siguiente antes de revisarlo.
SELECT id, folio_orden, nombre_unidad_medica, motivo_servicio
FROM public.ordenes_servicio
WHERE (id=1 AND folio_orden=1001)
   OR (id=2 AND folio_orden=1002)
   OR (id=7 AND folio_orden=1005)
   OR (id=8 AND folio_orden=0)
ORDER BY id;

-- Revisar claves foráneas: la limpieza NO hace CASCADE.
SELECT conname AS restriccion, conrelid::regclass AS tabla_dependiente
FROM pg_constraint
WHERE contype='f' AND confrelid='public.ordenes_servicio'::regclass;

-- Verifica los folios duplicados existentes.
SELECT folio_orden, COUNT(*) AS cantidad
FROM public.ordenes_servicio
GROUP BY folio_orden HAVING COUNT(*) > 1;

-- Inspecciona triggers que ya existan, para evitar doble lógica en la DB.
SELECT tgname, pg_get_triggerdef(oid) AS definicion
FROM pg_trigger
WHERE tgrelid='public.ordenes_servicio'::regclass AND NOT tgisinternal;
