// api/admin.js
// Backend del panel admin de TRAMA.
// Toda operación sensible corre acá, con service_role, nunca en el navegador.
//
// Variables de entorno necesarias en Vercel:
//   ADMIN_PASS          → contraseña del panel (elegí una fuerte y larga)
//   SUPABASE_URL        → https://mcpmabvxmdepastmpzbi.supabase.co
//   SUPABASE_SERVICE_KEY→ service_role key (Settings → API → service_role)
//   SITE_URL            → https://www.tramapunto.com (para los emails)
//
// El front manda la contraseña en el header 'x-admin-pass'. Se compara
// en el servidor con una comparación de tiempo constante propia (sin
// depender del módulo 'crypto', para que funcione en cualquier runtime).

const SB_URL      = process.env.SUPABASE_URL;
const SB_SERVICE  = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASS  = process.env.ADMIN_PASS;
const SITE_URL    = process.env.SITE_URL || 'https://www.tramapunto.com';

// Comparación de contraseñas resistente a timing attacks, sin 'crypto'.
function passOk(input) {
  if (!input || !ADMIN_PASS) return false;
  const a = String(input);
  const b = String(ADMIN_PASS);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Helper para pegarle a Supabase con service_role (bypassea RLS)
async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SB_SERVICE,
      'Authorization': `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' || method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `Supabase HTTP ${r.status}`);
  }
  return method === 'PATCH' || method === 'DELETE' ? null : r.json();
}

// Dispara un email vía la función existente de Resend (no rompe si falla)
async function enviarEmail(tipo, to, data) {
  try {
    await fetch(`${SITE_URL}/api/enviar-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, to, data }),
    });
  } catch (_) { /* el email es best-effort, no bloquea la operación */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // 1) Autenticación
  if (!passOk(req.headers['x-admin-pass'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { action, payload = {} } = req.body || {};

  try {
    switch (action) {

      // — Listar creators (todos, para el panel) —
      case 'list_creators': {
        const data = await sb('creators?select=*&order=created_at.desc');
        return res.status(200).json({ ok: true, data });
      }

      // — Listar campañas (todas, incluidas en_revision) —
      case 'list_campanias': {
        const data = await sb('campanias_con_conteo?select=*&order=created_at.desc');
        return res.status(200).json({ ok: true, data });
      }

      // — Ver postulaciones de una campaña (con datos del creador) —
      case 'list_postulaciones': {
        const { campania_id } = payload;
        if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });
        const data = await sb(
          `postulaciones?campania_id=eq.${campania_id}&select=*,creators(nombre,apellido,email,tel,ig_user,ig_seg,niches,avatar_url)&order=created_at.desc`
        );
        return res.status(200).json({ ok: true, data });
      }

      // — Cambiar estado de un creator (aprobar/rechazar) + email —
      case 'set_creator_status': {
        const { id, status, nota } = payload;
        if (!id || !status) return res.status(400).json({ error: 'Faltan id/status' });
        const body = { status };
        if (nota !== undefined) body.admin_nota = nota;
        await sb(`creators?id=eq.${id}`, 'PATCH', body);

        // Email al creador
        const rows = await sb(`creators?id=eq.${id}&select=nombre,email`);
        const c = rows?.[0];
        if (c) {
          if (status === 'aprobado') await enviarEmail('creator_aprobado', c.email, { nombre: c.nombre });
          if (status === 'rechazado') await enviarEmail('creator_rechazado', c.email, { nombre: c.nombre, nota: nota || '' });
        }
        return res.status(200).json({ ok: true });
      }

      // — Cambiar estado de una campaña (activar/cerrar/rechazar) + email —
      case 'set_campania_status': {
        const { id, estado, nota } = payload;
        if (!id || !estado) return res.status(400).json({ error: 'Faltan id/estado' });
        const body = { estado };
        if (nota !== undefined) body.nota_admin = nota;
        await sb(`campanias?id=eq.${id}`, 'PATCH', body);

        // Email a la marca cuando se activa
        if (estado === 'activa') {
          const rows = await sb(`campanias?id=eq.${id}&select=marca_nombre,marca_email,titulo`);
          const m = rows?.[0];
          if (m) await enviarEmail('campania_activa', m.marca_email, {
            nombre: m.marca_nombre, titulo: m.titulo,
          });
        }
        return res.status(200).json({ ok: true });
      }

      // — Guardar nota interna de un creator —
      case 'set_creator_nota': {
        const { id, nota } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`creators?id=eq.${id}`, 'PATCH', { admin_nota: nota || null });
        return res.status(200).json({ ok: true });
      }

      // — Leer la configuración (precios) —
      case 'get_config': {
        const data = await sb('config?select=*&order=clave');
        return res.status(200).json({ ok: true, data });
      }

      // — Guardar un valor de configuración —
      case 'set_config': {
        const { clave, valor } = payload;
        if (!clave || valor === undefined) {
          return res.status(400).json({ error: 'Faltan clave/valor' });
        }
        if (clave.startsWith('precio_')) {
          const n = Number(valor);
          if (!Number.isFinite(n) || n < 0 || n > 10000000) {
            return res.status(400).json({ error: 'Precio inválido' });
          }
        }
        // Upsert manual: PATCH si la clave existe, INSERT si no.
        // (Antes un PATCH sobre una clave inexistente devolvía OK sin
        //  cambiar nada → el precio quedaba "pegado" en el fallback.)
        const existe = await sb(`config?clave=eq.${encodeURIComponent(clave)}&select=clave`);
        if (existe && existe.length) {
          await sb(`config?clave=eq.${encodeURIComponent(clave)}`, 'PATCH', { valor: String(valor) });
        } else {
          await sb('config', 'POST', { clave, valor: String(valor) });
        }
        return res.status(200).json({ ok: true });
      }

      // — Eliminar un creator DEFINITIVAMENTE (fila + cuenta de Auth) —
      case 'delete_creator': {
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        let email = null;
        try {
          const rows = await sb(`creators?id=eq.${id}&select=email`);
          email = rows?.[0]?.email || null;
        } catch (_) { /* seguimos igual */ }
        await sb(`creators?id=eq.${id}`, 'DELETE');
        if (email) {
          try {
            const u = await fetch(
              `${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
              { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } }
            ).then(r => r.ok ? r.json() : null);
            const authId = u?.users?.[0]?.id || u?.[0]?.id || null;
            if (authId) {
              await fetch(`${SB_URL}/auth/v1/admin/users/${authId}`, {
                method: 'DELETE',
                headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
              });
            }
          } catch (_) { /* best-effort */ }
        }
        return res.status(200).json({ ok: true });
      }

      // — Crear cuentas de acceso para creators que no la tienen (backfill) —
      case 'backfill_cuentas': {
        const LOTE = Math.min(Number(payload.limit) || 20, 40);
        const creators = await sb('creators?select=email');
        const emailsCreators = [...new Set(
          (creators || []).map(c => (c.email || '').trim().toLowerCase()).filter(Boolean)
        )];
        const authEmails = new Set();
        let page = 1;
        for (;;) {
          const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
            headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          });
          if (!r.ok) break;
          const j = await r.json();
          const list = j.users || j.data || (Array.isArray(j) ? j : []);
          list.forEach(u => u.email && authEmails.add(u.email.trim().toLowerCase()));
          if (!list.length || list.length < 1000) break;
          page++;
          if (page > 20) break;
        }
        const faltantes = emailsCreators.filter(e => !authEmails.has(e));
        const aProcesar = faltantes.slice(0, LOTE);
        let creadas = 0, mails = 0;
        const errores = [];
        for (const email of aProcesar) {
          try {
            const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, {
              method: 'POST',
              headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, email_confirm: true }),
            });
            if (!cr.ok) { const e = await cr.json().catch(() => ({})); throw new Error(e.msg || e.message || `HTTP ${cr.status}`); }
            creadas++;
            const rec = await fetch(`${SB_URL}/auth/v1/recover`, {
              method: 'POST',
              headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
            });
            if (rec.ok) mails++;
          } catch (e) {
            errores.push({ email, error: e.message });
          }
        }
        return res.status(200).json({
          ok: true,
          total_faltantes: faltantes.length,
          creadas, mails,
          restantes: faltantes.length - aProcesar.length,
          errores,
        });
      }

      // — Definir una contraseña nueva para un creator (desde el admin) —
      case 'set_creator_password': {
        const { email, password } = payload;
        if (!email || !password) return res.status(400).json({ error: 'Faltan email/password' });
        if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        const u = await fetch(
          `${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
          { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } }
        ).then(r => r.ok ? r.json() : null);
        const authId = u?.users?.[0]?.id || u?.[0]?.id || null;
        if (!authId) return res.status(404).json({ error: 'Ese creator no tiene cuenta de acceso' });
        const up = await fetch(`${SB_URL}/auth/v1/admin/users/${authId}`, {
          method: 'PUT',
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: String(password) }),
        });
        if (!up.ok) { const e = await up.json().catch(() => ({})); throw new Error(e.msg || e.message || `HTTP ${up.status}`); }
        return res.status(200).json({ ok: true });
      }

      // — Mandarle a un creator el email de reseteo de contraseña —
      case 'send_reset': {
        const { email } = payload;
        if (!email) return res.status(400).json({ error: 'Falta email' });
        const rr = await fetch(`${SB_URL}/auth/v1/recover`, {
          method: 'POST',
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!rr.ok) { const e = await rr.json().catch(() => ({})); throw new Error(e.msg || e.message || `HTTP ${rr.status}`); }
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: `Acción desconocida: ${action}` });
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
