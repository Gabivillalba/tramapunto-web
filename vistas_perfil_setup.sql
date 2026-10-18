-- ════════════════════════════════════════════════════════════
-- STATS DEL CREADOR — tabla de vistas de perfil.
-- Se registra cuando alguien abre el detalle de un creador en la bolsa
-- (index.html openModal → /api/ver-perfil, con service_role).
-- El creador lee solo las suyas; anon no tiene acceso. Aplicado 17-oct-2026.
-- ════════════════════════════════════════════════════════════

create table if not exists public.vistas_perfil (
  id         bigint generated always as identity primary key,
  creator_id uuid not null references public.creators(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists vistas_perfil_creator_fecha
  on public.vistas_perfil (creator_id, created_at desc);

alter table public.vistas_perfil enable row level security;

-- El creador lee solo sus propias vistas (match por email del JWT).
create policy vistas_select_propias on public.vistas_perfil
  for select to authenticated
  using (
    creator_id in (
      select id from public.creators
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Mínimo privilegio: nada para anon; solo SELECT de columnas públicas para
-- authenticated. Nadie tiene INSERT (solo el service_role, que saltea RLS).
revoke all on public.vistas_perfil from anon;
revoke all on public.vistas_perfil from authenticated;
grant select (creator_id, created_at) on public.vistas_perfil to authenticated;
