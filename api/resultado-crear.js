// api/resultado-crear.js
// La MARCA cierra una campaña con resultados para un creador.
// Verifica por JWT que la campaña sea suya (marca_email) y guarda las métricas.
// Luego tanto la marca como el creador las ven en su panel (RLS por email).

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const SB_ANON    = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcG1hYnZ4bWRlcGFzdG1wemJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDYwMDQsImV4cCI6MjA5NjkyMjAwNH0.4Sk9rKEtVjibczByGztgr_wOwyTH3c8XgOKtJHSzwRw';

async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text().catch(() => '')));
  return r.json();
}

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

const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const marcaEmail = await emailDelToken(token);
  if (!marcaEmail) return res.status(401).json({ error: 'Sesión no válida' });

  const b = req.body || {};
  const { campania_id, creator_id } = b;
  if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });
  if (!creator_id) return res.status(400).json({ error: 'Elegí el creador' });

  try {
    // 1) La campaña tiene que ser de esta marca
    const camps = await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}&select=id,titulo,marca_email,marca_nombre`);
    const camp = camps && camps[0];
    if (!camp) return res.status(404).json({ error: 'Campaña no encontrada' });
    if (String(camp.marca_email || '').toLowerCase() !== marcaEmail) {
      return res.status(403).json({ error: 'Esta campaña no es tuya' });
    }

    // 2) Datos del creador
    const cres = await sb(`creators?id=eq.${encodeURIComponent(creator_id)}&select=id,nombre,apellido,email`);
    const cre = cres && cres[0];
    if (!cre) return res.status(404).json({ error: 'Creador no encontrado' });

    // 3) Guardar el resultado
    const row = {
      campania_id,
      campania_titulo: camp.titulo || null,
      creator_id,
      creator_nombre: `${cre.nombre || ''} ${cre.apellido || ''}`.trim() || null,
      creator_email: cre.email || null,
      marca_email: marcaEmail,
      marca_nombre: camp.marca_nombre || null,
      alcance: numOrNull(b.alcance),
      interacciones: numOrNull(b.interacciones),
      clics: numOrNull(b.clics),
      ventas: numOrNull(b.ventas),
      piezas: numOrNull(b.piezas),
      nota: (b.nota && String(b.nota).trim()) ? String(b.nota).trim().slice(0, 1000) : null,
    };
    const inserted = await sb('resultados_campania', 'POST', row);

    // 4) Notificar al creador (in-app, sin email)
    if (cre.email) {
      await sb('notificaciones', 'POST', {
        para_email: cre.email, tipo: 'sistema',
        titulo: '📊 Tenés resultados de una campaña',
        cuerpo: `${camp.marca_nombre || 'Una marca'} cargó los resultados de "${camp.titulo || 'una campaña'}". Miralos en tu panel.`,
        link: '/perfil.html',
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, resultado: inserted && inserted[0] ? inserted[0] : null });
  } catch (err) {
    console.error('resultado-crear error:', err);
    return res.status(500).json({ error: err.message });
  }
}
