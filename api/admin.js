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
// Recorre siempre TODOS los caracteres del valor esperado, acumulando
// diferencias con XOR, para no filtrar información por el tiempo.
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
        // Validación: los precios deben ser números positivos razonables
        if (clave.startsWith('precio_')) {
          const n = Number(valor);
          if (!Number.isFinite(n) || n < 0 || n > 10000000) {
            return res.status(400).json({ error: 'Precio inválido' });
          }
        }
        await sb(`config?clave=eq.${encodeURIComponent(clave)}`, 'PATCH', { valor: String(valor) });
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
