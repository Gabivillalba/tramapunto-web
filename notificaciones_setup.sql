-- ════════════════════════════════════════════════════════════
-- CENTRO DE NOTIFICACIONES IN-APP (18-oct-2026)
-- Reemplaza la dependencia del email (que tiene límite diario). Cada evento
-- crea una notificación vía trigger (SECURITY DEFINER). El usuario ve/marca
-- leídas solo las suyas (RLS por email del JWT); el admin las lee con
-- service_role (para_admin=true). Aplicado en producción.
-- ════════════════════════════════════════════════════════════
create table if not exists public.notificaciones (
  id         bigint generated always as identity primary key,
  para_email text,
  para_admin boolean not null default false,
  tipo       text not null,
  titulo     text not null,
  cuerpo     text,
  link       text,
  leida      boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notif_para  on public.notificaciones (lower(para_email), leida, created_at desc);
create index if not exists notif_admin on public.notificaciones (leida, created_at desc) where para_admin;

alter table public.notificaciones enable row level security;
create policy notif_select on public.notificaciones for select to authenticated
  using (para_email is not null and lower(para_email)=lower(auth.jwt()->>'email'));
create policy notif_update on public.notificaciones for update to authenticated
  using (para_email is not null and lower(para_email)=lower(auth.jwt()->>'email'))
  with check (para_email is not null and lower(para_email)=lower(auth.jwt()->>'email'));
revoke all on public.notificaciones from anon;
revoke all on public.notificaciones from authenticated;
grant select (id, para_email, tipo, titulo, cuerpo, link, leida, created_at) on public.notificaciones to authenticated;
grant update (leida) on public.notificaciones to authenticated;

-- Triggers: ver el detalle en la migración (notif_venta, notif_resena,
-- notif_postulacion, notif_registro_creator, notif_registro_marca).
-- Todos SECURITY DEFINER, insertan en notificaciones según el evento.
