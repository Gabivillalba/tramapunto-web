-- ════════════════════════════════════════════════════════════
-- ENVÍOS DE EMAIL PROGRAMADOS (admin). Solo la toca el service_role
-- (admin.js para agendar/cancelar, /api/emails-cron para enviar los vencidos).
-- Cron en vercel.json: /api/emails-cron cada hora. Aplicado 18-oct-2026.
-- ════════════════════════════════════════════════════════════
create table if not exists public.emails_programados (
  id         bigint generated always as identity primary key,
  asunto     text not null,
  cuerpo     text not null,
  segmento   text not null,
  enviar_at  timestamptz not null,
  estado     text not null default 'pendiente',   -- pendiente|enviado|cancelado|error
  enviados   int,
  total      int,
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists emails_prog_pendientes on public.emails_programados (estado, enviar_at);
alter table public.emails_programados enable row level security;
revoke all on public.emails_programados from anon;
revoke all on public.emails_programados from authenticated;
