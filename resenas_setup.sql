-- ════════════════════════════════════════════════════════════
-- RESEÑAS — las marcas (compradores) califican a los creadores
-- Correr en Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════

-- 1) Cache de rating en creators (para que la bolsa sea rápida y ordenable)
alter table public.creators add column if not exists rating_prom  numeric(3,2) default 0;
alter table public.creators add column if not exists rating_count int          default 0;

-- 2) Tabla de reseñas (una por comprador por creador; editable)
create table if not exists public.resenas (
  id           bigint generated always as identity primary key,
  creator_id   uuid        not null references public.creators(id) on delete cascade,
  marca_email  text        not null,
  marca_nombre text,
  rating       int         not null check (rating between 1 and 5),
  comentario   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (marca_email, creator_id)
);

alter table public.resenas enable row level security;
drop policy if exists resenas_rw on public.resenas;
create policy resenas_rw on public.resenas
  for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.resenas to anon, authenticated;
create index if not exists idx_resenas_creator on public.resenas (creator_id);

-- 3) Trigger: recalcula rating_prom y rating_count del creator ante cualquier cambio
create or replace function public.recalc_rating() returns trigger
language plpgsql as $$
declare cid uuid;
begin
  cid := coalesce(new.creator_id, old.creator_id);
  update public.creators set
    rating_count = (select count(*)                       from public.resenas where creator_id = cid),
    rating_prom  = coalesce((select round(avg(rating)::numeric,2) from public.resenas where creator_id = cid), 0)
  where id = cid;
  return null;
end $$;

drop trigger if exists trg_recalc_rating on public.resenas;
create trigger trg_recalc_rating
  after insert or update or delete on public.resenas
  for each row execute function public.recalc_rating();

-- ════════════════════════════════════════════════════════════
-- MODERACIÓN (agregado 18-oct-2026): ocultar/responder reseñas desde el admin.
-- El rating cacheado ignora las ocultas. Aplicado en producción.
-- ════════════════════════════════════════════════════════════
alter table public.resenas add column if not exists oculta       boolean not null default false;
alter table public.resenas add column if not exists respuesta    text;
alter table public.resenas add column if not exists respuesta_at timestamptz;

create or replace function public.recalc_rating() returns trigger
language plpgsql as $$
declare cid uuid;
begin
  cid := coalesce(new.creator_id, old.creator_id);
  update public.creators set
    rating_count = (select count(*)                            from public.resenas where creator_id = cid and oculta is not true),
    rating_prom  = coalesce((select round(avg(rating)::numeric,2) from public.resenas where creator_id = cid and oculta is not true), 0)
  where id = cid;
  return null;
end $$;
