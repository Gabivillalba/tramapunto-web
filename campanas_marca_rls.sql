-- ════════════════════════════════════════════════════════════
-- Permisos para que la MARCA vea sus campañas y postulantes
-- Correr en Supabase → SQL Editor → Run
-- ════════════════════════════════════════════════════════════

-- 1) La marca ve SUS campañas en cualquier estado (además de las activas públicas)
drop policy if exists campanias_select_propias on public.campanias;
create policy campanias_select_propias on public.campanias
  for select to authenticated
  using (lower(marca_email) = lower((auth.jwt() ->> 'email')));

-- 2) La marca ve las postulaciones a SUS campañas
drop policy if exists postulaciones_select_marca on public.postulaciones;
create policy postulaciones_select_marca on public.postulaciones
  for select to authenticated
  using (
    campania_id in (
      select id from public.campanias
      where lower(marca_email) = lower((auth.jwt() ->> 'email'))
    )
  );
