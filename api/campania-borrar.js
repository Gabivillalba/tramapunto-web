// api/campania-borrar.js
// Permite que una MARCA borre una campaña PROPIA desde su panel.
// Verifica la identidad con su JWT (email del token) y que la campaña
// le pertenezca (marca_email). El borrado corre con service_role.
// FK seguras: postulaciones.campania_id = CASCADE, conexiones.campania_id = SET NULL.

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const SB_ANON    = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcG1hYnZ4bWRlcGFzdG1wemJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDYwMDQsImV4cCI6MjA5NjkyMjAwNH0.4Sk9rKEtVjibczByGztgr_wOwyTH3c8XgOKtJHSzwRw';

async function emailDelToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.email) ? String(u.email) : null;
  } catch { return null; }
}

async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return method === 'DELETE' ? null : r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const email = await emailDelToken(token);
  if (!email) return res.status(401).json({ error: 'Sesión no válida' });

  const { campania_id } = req.body || {};
  if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });

  try {
    const rows = await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}&select=id,marca_email`);
    const c = rows && rows[0];
    if (!c) return res.status(404).json({ error: 'Campaña no encontrada' });
    if (String(c.marca_email || '').toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'Esta campaña no es tuya' });
    }
    await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}`, 'DELETE');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('campania-borrar error:', err);
    return res.status(500).json({ error: err.message });
  }
}
