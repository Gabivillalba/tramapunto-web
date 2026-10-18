// api/contacto.js
// Devuelve los datos de contacto de un creador SOLO si quien pide:
//   (a) es el propio creador (self), o
//   (b) tiene una conexión PAGADA con ese creador, vigente (<= 60 días).
// Corre con service_role, pero verifica la identidad del solicitante con su
// propio JWT (no confía en un email mandado por el cliente).
//
// Motivo: las columnas de contacto (email, tel, @usuarios) ya no son legibles
// con la clave pública, así que el contacto se sirve únicamente desde acá,
// detrás de la verificación de pago.

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const SB_ANON    = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcG1hYnZ4bWRlcGFzdG1wemJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDYwMDQsImV4cCI6MjA5NjkyMjAwNH0.4Sk9rKEtVjibczByGztgr_wOwyTH3c8XgOKtJHSzwRw';

const DIAS_ACCESO = 60;
const CONTACT_COLS = ['email', 'tel', 'ig_user', 'tt_user', 'yt_user', 'tw_user'];

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}

// Verifica el token del usuario y devuelve su email (o null).
async function emailDelToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.email) ? String(u.email).toLowerCase() : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // Identidad real del solicitante, desde su JWT (no desde el body)
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const solicitante = await emailDelToken(token);
  if (!solicitante) return res.status(401).json({ error: 'Sesión no válida' });

  // IDs pedidos
  let ids = [];
  const { creator_id, creator_ids } = req.body || {};
  if (Array.isArray(creator_ids)) ids = creator_ids;
  else if (creator_id) ids = [creator_id];
  ids = [...new Set(ids.filter(Boolean).map(String))].slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: 'Falta creator_id' });

  try {
    const inList = '(' + ids.map(encodeURIComponent).join(',') + ')';

    // Creadores pedidos (con contacto, vía service_role)
    const creators = await sb(`creators?id=in.${inList}&select=id,email,${CONTACT_COLS.join(',')}`);
    const byId = Object.fromEntries((creators || []).map(c => [String(c.id), c]));

    // Conexiones pagadas y vigentes de ESTE solicitante hacia esos creadores
    const desde = new Date(Date.now() - DIAS_ACCESO * 86400000).toISOString();
    const cxs = await sb(
      `conexiones?marca_email=ilike.${encodeURIComponent(solicitante)}` +
      `&creator_id=in.${inList}&estado=eq.pagado&created_at=gte.${desde}` +
      `&select=creator_id`
    );
    const pagados = new Set((cxs || []).map(x => String(x.creator_id)));

    const contactos = {};
    for (const id of ids) {
      const c = byId[id];
      if (!c) continue;
      const esPropio = c.email && String(c.email).toLowerCase() === solicitante;
      if (esPropio || pagados.has(id)) {
        const out = {};
        CONTACT_COLS.forEach(k => { if (c[k]) out[k] = c[k]; });
        contactos[id] = out;
      }
    }

    return res.status(200).json({ ok: true, contactos });
  } catch (err) {
    console.error('contacto error:', err);
    return res.status(500).json({ error: err.message });
  }
}
