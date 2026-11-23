-- campanias_fechas.sql
-- Fecha de inicio (= fecha de aprobación) de cada campaña + la vista de conteo
-- actualizada para exponerla. YA APLICADO en producción (proyecto
-- qoyekzqvjszeexdebrls) el 23/11/2026 vía migración `campanias_fecha_inicio`.
-- Se deja en el repo como fuente de verdad del esquema.

alter table public.campanias add column if not exists fecha_inicio date;

-- Backfill: campañas ya publicadas o cerradas sin fecha_inicio -> su creación.
update public.campanias
   set fecha_inicio = created_at::date
 where fecha_inicio is null
   and estado in ('activa','cerrada');

-- Vista de conteo con fecha_inicio anexada al final (no altera el orden del
-- resto, para que CREATE OR REPLACE no falle).
create or replace view public.campanias_con_conteo as
 SELECT c.id, c.marca_nombre, c.marca_email, c.marca_telefono, c.marca_instagram,
    c.titulo, c.descripcion, c.tipo, c.formatos, c.entregables, c.requisitos,
    c.presupuesto_min, c.presupuesto_max, c.moneda, c.es_canje, c.es_presencial,
    c.ubicacion, c.fecha_limite, c.cupos, c.estado, c.nota_admin, c.created_at,
    c.updated_at,
    COALESCE(p.total, 0::bigint) AS total_postulaciones,
    c.fecha_inicio
   FROM campanias c
     LEFT JOIN ( SELECT postulaciones.campania_id, count(*) AS total
           FROM postulaciones
          WHERE postulaciones.estado <> 'retirada'::text
          GROUP BY postulaciones.campania_id) p ON p.campania_id = c.id;
