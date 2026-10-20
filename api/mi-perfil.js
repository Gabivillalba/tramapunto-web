// api/mi-perfil.js
// Devuelve el perfil propio del usuario logueado (creator o marca), fila
// completa, usando service_role y verificando la identidad con su JWT.
//
// Motivo: desde que el contacto de los creadores dejó de ser legible con la
// clave pública/authenticated, el propio perfil no se puede buscar por
// `email=eq...` desde el cliente (filtrar por una columna requiere poder
// leerla). Esta búsqueda se hace acá, en el servidor.

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

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const email = await emailDelToken(token);
  if (!email) return res.status(401).json({ error: 'Sesión no válida' });

  const enc = encodeURIComponent(email);
  try {
    const cre = await sb(`creators?email=ilike.${enc}&limit=1&select=*`);
    if (cre && cre[0]) {
      const prof = cre[0];
      // Nunca mandar los tokens de MercadoPago al navegador (solo si está conectado)
      delete prof.mp_access_token;
      delete prof.mp_refresh_token;
      return res.status(200).json({ type: 'creator', profile: prof });
    }

    const mar = await sb(`marcas?email=ilike.${enc}&limit=1&select=*`);
    if (mar && mar[0]) return res.status(200).json({ type: 'marca', profile: mar[0] });

    return res.status(200).json({ type: null });
  } catch (err) {
    console.error('mi-perfil error:', err);
    return res.status(500).json({ error: err.message });
  }
}
