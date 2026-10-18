-- ════════════════════════════════════════════════════════════
-- FILTROS GUARDADOS CROSS-DEVICE (18-oct-2026)
-- La bolsa guarda las búsquedas del usuario logueado en la base (no solo en el
-- navegador), para verlas desde cualquier dispositivo. RLS por email del JWT.
-- index.html usa el access_token (sb_token) y lo refresca con sb_refresh.
-- ════════════════════════════════════════════════════════════
create table if not exists public.filtros_guardados (
  id         bigint generated always as identity primary key,
  user_email text not null,
  nombre     text not null,
  estado     jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_email, nombre)
);
alter table public.filtros_guardados enable row level security;
create policy filtros_rw on public.filtros_guardados for all to authenticated
  using (lower(user_email)=lower(auth.jwt()->>'email'))
  with check (lower(user_email)=lower(auth.jwt()->>'email'));
revoke all on public.filtros_guardados from anon;
revoke all on public.filtros_guardados from authenticated;
grant select, insert, update, delete on public.filtros_guardados to authenticated;
