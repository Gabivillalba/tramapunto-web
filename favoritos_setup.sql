-- ════════════════════════════════════════════════════════════
-- FAVORITOS — "Creators guardados" para las marcas (y creadores)
-- Correr en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════

create table if not exists public.favoritos (
  id          bigint generated always as identity primary key,
  marca_email text        not null,
  creator_id  uuid        not null references public.creators(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (marca_email, creator_id)       -- no se puede guardar dos veces el mismo
);

alter table public.favoritos enable row level security;

drop policy if exists favoritos_rw on public.favoritos;
create policy favoritos_rw on public.favoritos
  for all to anon, authenticated
  using (true) with check (true);

grant select, insert, delete on public.favoritos to anon, authenticated;

create index if not exists idx_favoritos_marca on public.favoritos (marca_email);
