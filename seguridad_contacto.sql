-- ════════════════════════════════════════════════════════════
-- SEGURIDAD: el contacto de los creadores NO debe ser legible con
-- la clave pública (anon). Hoy cualquiera podía hacer
--   GET /creators?status=eq.aprobado&select=email,tel
-- con la anon key (que está en el JS del sitio) y llevarse todos los
-- contactos sin pagar. Esto lo cierra.
--
-- ⚠️ CORRER DESPUÉS de que deploye el nuevo pago-exitoso.html (1-2 min).
--     El contacto ahora se sirve desde /api/contacto (con verificación de pago).
-- ════════════════════════════════════════════════════════════

revoke select (email, tel, ig_user, tt_user, yt_user, tw_user, admin_nota)
  on public.creators from anon;

-- Nota: 'authenticated' conserva la lectura por ahora (lo usan el perfil del
-- propio creador y "Mis conexiones" con el token del usuario). El cierre total
-- del lado autenticado es la fase 2 (requiere mover esas lecturas al endpoint
-- y endurecer el alta de conexiones; se hace con testeo del webhook).
