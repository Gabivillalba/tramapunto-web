-- ============================================================================
-- TRAMA. LABS — Esquema completo (correr tras el reset de Supabase del 12/11)
--
-- Consolida y REEMPLAZA a los borradores tramalabs_schema.sql / _2.sql:
-- acá todo es EMAIL-KEYED, igual que el resto del código de TRAMA. (creators,
-- conexiones y notificaciones se manejan por email). El contenido pago se sirve
-- SIEMPRE server-side (service_role) tras verificar la suscripción — el cliente
-- nunca lee las tablas de contenido/alumno directo. Idempotente (IF NOT EXISTS).
-- ============================================================================

-- ─────────────────────────────── CATEGORÍAS ────────────────────────────────
create table if not exists public.categorias (
  id     uuid primary key default gen_random_uuid(),
  tipo   text not null check (tipo in ('curso','prompt','recurso')),
  nombre text not null,
  slug   text not null,
  orden  int default 0,
  unique (tipo, slug)
);
insert into public.categorias (tipo, nombre, slug, orden) values
  ('curso','Fundamentos','fundamentos',1),
  ('curso','Producción','produccion',2),
  ('curso','IA y animación','ia-animacion',3),
  ('curso','Negocio del creador','negocio',4),
  ('prompt','La imagen','la-imagen',1),
  ('prompt','El vídeo','el-video',2),
  ('prompt','Los formatos','los-formatos',3),
  ('recurso','Plantillas','plantillas',1),
  ('recurso','Guías','guias',2),
  ('recurso','Checklists','checklists',3)
on conflict (tipo, slug) do nothing;

-- ──────────────────────────────── CURSOS ───────────────────────────────────
create table if not exists public.cursos (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  titulo             text not null,
  subtitulo          text,
  descripcion        text,
  nivel              text default 'inicial',
  instructor         text,
  categoria_id       uuid references public.categorias(id),
  portada_url        text,
  duracion_min       int,
  orden              int default 0,
  gratis             boolean default false,  -- accesible sin suscripción (embudo)
  proteger_contenido boolean default true,   -- marca de agua + sin descarga
  publicado          boolean default false,
  created_at         timestamptz default now()
);

-- ─────────────────────────────── LECCIONES ─────────────────────────────────
-- video_url y recursos son GATED: el cliente no lee esta tabla; sale por el op.
create table if not exists public.lecciones (
  id           uuid primary key default gen_random_uuid(),
  curso_id     uuid not null references public.cursos(id) on delete cascade,
  orden        int not null default 0,
  titulo       text not null,
  descripcion  text,
  video_url    text,                        -- ID/URL del embed (Vimeo) — GATED
  duracion_seg int,
  recursos     jsonb default '[]'::jsonb,   -- [{titulo,url,tipo}] — GATED
  es_preview   boolean default false,       -- abierta aunque el curso sea pago
  created_at   timestamptz default now()
);
create index if not exists idx_lecciones_curso on public.lecciones(curso_id, orden);

-- Vista pública del temario (sin video_url ni recursos).
create or replace view public.lecciones_publicas as
  select id, curso_id, orden, titulo, descripcion, duracion_seg, es_preview
  from public.lecciones;

-- ──────────────────────────── BANCO DE RECURSOS ────────────────────────────
create table if not exists public.recursos_banco (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid references public.categorias(id),
  titulo       text not null,
  descripcion  text,
  archivo_url  text,                         -- R2 — GATED (view-only)
  tipo         text,
  orden        int default 0,
  publicado    boolean default false,
  created_at   timestamptz default now()
);
create or replace view public.recursos_publicos as
  select r.id, r.titulo, r.descripcion, r.tipo, r.orden, c.nombre as categoria
  from public.recursos_banco r
  left join public.categorias c on c.id = r.categoria_id
  where r.publicado = true;

-- ──────────────────────────── BIBLIOTECA DE PROMPTS ────────────────────────
create table if not exists public.prompts (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid references public.categorias(id),
  grupo        text,
  titulo       text not null,
  etiqueta     text,
  prompt       text,                         -- GATED
  imagen_url   text,                         -- GATED
  orden        int default 0,
  publicado    boolean default false,
  created_at   timestamptz default now()
);
create or replace view public.prompts_publicos as
  select p.id, p.grupo, p.titulo, p.etiqueta, p.orden, c.nombre as categoria
  from public.prompts p
  left join public.categorias c on c.id = p.categoria_id
  where p.publicado = true;

-- ──────────────────────────────── AVISOS ───────────────────────────────────
create table if not exists public.anuncios (
  id             uuid primary key default gen_random_uuid(),
  tipo           text default 'proximo_curso' check (tipo in ('proximo_curso','general')),
  titulo         text not null,
  cuerpo         text,
  categoria_id   uuid references public.categorias(id),
  fecha_estimada text,
  etiqueta       text,
  link           text,
  mostrar_en_hub boolean default true,
  activo         boolean default true,
  created_at     timestamptz default now()
);

-- ─────────────────────── SUSCRIPCIONES / PROGRESO / CERT ───────────────────
-- Todas EMAIL-KEYED y sin lectura del cliente (solo service_role).
create table if not exists public.suscripciones (
  email             text primary key,        -- un abono por email
  mp_preapproval_id text,
  plan              text default 'mensual',
  estado            text check (estado in ('activa','pausada','cancelada','vencida')) default 'pausada',
  vigencia_hasta    timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.progreso_lecciones (
  email         text not null,
  leccion_id    uuid not null references public.lecciones(id) on delete cascade,
  completado    boolean default true,
  completado_at timestamptz default now(),
  primary key (email, leccion_id)
);

create table if not exists public.certificados (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  curso_id        uuid not null references public.cursos(id) on delete cascade,
  codigo          text unique not null,
  nombre_mostrado text,
  emitido_at      timestamptz default now(),
  unique (email, curso_id)
);
-- Verificación pública por código (sin exponer el email).
create or replace view public.certificados_verificacion as
  select c.codigo, c.nombre_mostrado, c.emitido_at, cu.titulo as curso
  from public.certificados c
  join public.cursos cu on cu.id = c.curso_id;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.categorias         enable row level security;
alter table public.cursos             enable row level security;
alter table public.lecciones          enable row level security;
alter table public.recursos_banco     enable row level security;
alter table public.prompts            enable row level security;
alter table public.anuncios           enable row level security;
alter table public.suscripciones      enable row level security;
alter table public.progreso_lecciones enable row level security;
alter table public.certificados       enable row level security;

-- Público (catálogo / SEO): categorías, cursos publicados y avisos activos.
drop policy if exists categorias_sel on public.categorias;
create policy categorias_sel on public.categorias for select using (true);

drop policy if exists cursos_sel_pub on public.cursos;
create policy cursos_sel_pub on public.cursos for select using (publicado = true);

drop policy if exists anuncios_sel_pub on public.anuncios;
create policy anuncios_sel_pub on public.anuncios for select using (activo = true and mostrar_en_hub = true);

-- lecciones / recursos_banco / prompts / suscripciones / progreso / certificados:
-- RLS activa y SIN policy de cliente = sin acceso directo. El service_role
-- (los endpoints) la bypasea; el contenido se sirve tras verificar suscripción.

-- ============================================================================
-- GRANTS (vistas públicas para el catálogo y la verificación)
-- ============================================================================
grant select on public.lecciones_publicas        to anon, authenticated;
grant select on public.recursos_publicos          to anon, authenticated;
grant select on public.prompts_publicos           to anon, authenticated;
grant select on public.certificados_verificacion  to anon, authenticated;

-- Lista de espera (interesados pre-lanzamiento). Pre-12 los signups se guardan
-- en R2 con key aleatoria (la base está restringida); esta tabla es para
-- importarlos y usarlos post-lanzamiento (y para nuevos signups con la base viva).
create table if not exists public.labs_interesados (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  fuente     text,
  created_at timestamptz default now(),
  unique (email)
);
alter table public.labs_interesados enable row level security;
-- Sin policy de cliente: inserción y lectura solo server-side.

-- Precio de la suscripción (editable desde el admin, igual que precio_bolsa).
insert into public.config (clave, valor) values ('precio_labs', '30000')
on conflict (clave) do nothing;
