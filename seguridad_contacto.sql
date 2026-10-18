-- ════════════════════════════════════════════════════════════
-- SEGURIDAD: el contacto de los creadores NO debe ser legible con
-- la clave pública (anon).
--
-- OJO (lección aprendida): revocar columnas sueltas NO alcanza si el rol
-- tiene SELECT sobre toda la tabla (el permiso de tabla las cubre igual).
-- Hay que sacar el SELECT de tabla y volver a dar SOLO las columnas públicas.
--
-- ⚠️ El contacto ahora se sirve desde /api/contacto (con verificación de pago).
--    Ya aplicado en producción el 17-oct-2026.
-- ════════════════════════════════════════════════════════════

revoke select on public.creators from anon;

grant select (
  id, created_at, nombre, apellido, pais, ciudad, bio,
  ig_seg, ig_er, ig_alc, tt_seg, tt_er, tt_vistas, yt_seg, yt_vistas, tw_seg,
  plats, niches, nicho_esp, audiencia, idioma, moneda,
  t_story, t_reel, t_post, t_yt, canje, disponibilidad, dispon_nota, links, colabs,
  status, avatar_url, puntos_mes, racha, ultima_mision, indice,
  es_campeon, campeon_label, fotos, rating_prom, rating_count, fuente
) on public.creators to anon;

-- ════════════════════════════════════════════════════════════
-- FASE 2 (aplicada 17-oct-2026): cerrar el contacto también para
-- 'authenticated'. El perfil propio ahora se trae de /api/mi-perfil y el
-- contacto comprado de /api/contacto (ambos con service_role + verificación
-- de identidad por JWT). Además se bloquea que un cliente forje una conexión
-- 'pagado' (solo el webhook de Mercado Pago, con service_role, la marca).
-- ════════════════════════════════════════════════════════════

revoke select on public.creators from authenticated;

grant select (
  id, created_at, nombre, apellido, pais, ciudad, bio,
  ig_seg, ig_er, ig_alc, tt_seg, tt_er, tt_vistas, yt_seg, yt_vistas, tw_seg,
  plats, niches, nicho_esp, audiencia, idioma, moneda,
  t_story, t_reel, t_post, t_yt, canje, disponibilidad, dispon_nota, links, colabs,
  status, avatar_url, puntos_mes, racha, ultima_mision, indice,
  es_campeon, campeon_label, fotos, rating_prom, rating_count, fuente
) on public.creators to authenticated;

alter policy conexiones_insert on public.conexiones
  with check (estado is distinct from 'pagado');

-- ════════════════════════════════════════════════════════════
-- FIX (18-oct-2026) — regresión de la Fase 2.
-- Al revocar SELECT de creators.email a 'authenticated', se rompieron las
-- políticas RLS que hacían una subconsulta a creators.email
-- (el creador no podía ver sus ventas, vistas ni postulaciones: "permission
-- denied for table creators"). Solución: función SECURITY DEFINER que
-- devuelve los ids del creador logueado, y las políticas la usan en vez de
-- consultar creators.email directamente.
-- ════════════════════════════════════════════════════════════
create or replace function public.mis_creator_ids()
returns setof uuid language sql stable security definer set search_path=public as $$
  select id from public.creators where lower(email)=lower(auth.jwt()->>'email')
$$;
revoke all on function public.mis_creator_ids() from public;
grant execute on function public.mis_creator_ids() to authenticated, anon;

alter policy conexiones_select_creador   on public.conexiones    using (creator_id in (select public.mis_creator_ids()));
alter policy vistas_select_propias        on public.vistas_perfil using (creator_id in (select public.mis_creator_ids()));
alter policy postulaciones_select_propias on public.postulaciones using (creador_id in (select public.mis_creator_ids()));
alter policy postulaciones_update_retirar on public.postulaciones using (creador_id in (select public.mis_creator_ids()));
