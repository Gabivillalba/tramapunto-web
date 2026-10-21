// api/mi-perfil.js
// 1) POST  -> devuelve el perfil propio del usuario logueado (creator o marca).
// 2) GET ?mp_oauth=start    -> arranca la conexión de MercadoPago del creador (OAuth).
// 3) GET ?mp_oauth=callback -> MercadoPago redirige acá; guardamos los tokens del creador.
//
// El contacto de los creadores dejó de ser legible con la clave pública, así que
// el propio perfil se busca por email acá, en el servidor (service_role + JWT).
// El OAuth vive acá (y no en un archivo nuevo) para no pasar el límite de 12 funciones.
import { encrypt } from '../lib/mp-crypto.js';

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const SB_ANON    = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jcG1hYnZ4bWRlcGFzdG1wemJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDYwMDQsImV4cCI6MjA5NjkyMjAwNH0.4Sk9rKEtVjibczByGztgr_wOwyTH3c8XgOKtJHSzwRw';

// Redirect URI del OAuth de MercadoPago (coincide con la registrada en la app de MP).
const MP_REDIRECT = `${process.env.SITE_URL}/mp/callback`;

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

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Supabase PATCH ' + r.status + ' ' + (await r.text().catch(() => '')));
}

export default async function handler(req, res) {
  const mpOauth = req.query && req.query.mp_oauth;

  // ══ OAuth MercadoPago: INICIO ══ (el creador logueado arranca la conexión)
  if (req.method === 'GET' && mpOauth === 'start') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const email = await emailDelToken(token);
    if (!email) return res.status(401).json({ error: 'Sesión no válida' });
    if (!process.env.MP_CLIENT_ID) {
      return res.status(200).json({ mensaje: 'La conexión con MercadoPago todavía no está configurada. En breve queda lista.' });
    }
    try {
      const cre = await sbGet(`creators?email=ilike.${encodeURIComponent(email)}&limit=1&select=id`);
      if (!cre || !cre[0]) return res.status(404).json({ error: 'Perfil de creador no encontrado' });
      const state = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
      await sbPatch(`creators?id=eq.${encodeURIComponent(cre[0].id)}`, { mp_oauth_state: state });
      const url = `https://auth.mercadopago.com.ar/authorization`
        + `?client_id=${encodeURIComponent(process.env.MP_CLIENT_ID)}`
        + `&response_type=code&platform_id=mp`
        + `&state=${encodeURIComponent(state)}`
        + `&redirect_uri=${encodeURIComponent(MP_REDIRECT)}`;
      return res.status(200).json({ url });
    } catch (err) {
      console.error('mp start error:', err);
      return res.status(500).json({ error: 'No se pudo iniciar la conexión' });
    }
  }

  // ══ OAuth MercadoPago: CALLBACK ══ (MercadoPago nos manda code + state)
  if (req.method === 'GET' && mpOauth === 'callback') {
    const { code, state } = req.query || {};
    const back = (q) => { res.writeHead(302, { Location: `${process.env.SITE_URL}/perfil.html?mp=${q}` }); res.end(); };
    if (!code || !state) return back('err');
    try {
      const cre = await sbGet(`creators?mp_oauth_state=eq.${encodeURIComponent(state)}&limit=1&select=id`);
      if (!cre || !cre[0]) return back('err');

      const tok = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.MP_CLIENT_ID,
          client_secret: process.env.MP_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code, redirect_uri: MP_REDIRECT,
        }),
      });
      const t = await tok.json();
      if (!tok.ok || !t.access_token) { console.error('mp token error:', t); return back('err'); }

      const expira = t.expires_in ? new Date(Date.now() + Number(t.expires_in) * 1000).toISOString() : null;
      await sbPatch(`creators?id=eq.${encodeURIComponent(cre[0].id)}`, {
        mp_user_id: t.user_id ? String(t.user_id) : null,
        mp_access_token: encrypt(t.access_token),
        mp_refresh_token: encrypt(t.refresh_token || null),
        mp_token_expira: expira,
        mp_conectado: true,
        mp_oauth_state: null,
      });
      return back('ok');
    } catch (err) {
      console.error('mp callback error:', err);
      return back('err');
    }
  }

  // ══ Perfil propio ══
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const email = await emailDelToken(token);
  if (!email) return res.status(401).json({ error: 'Sesión no válida' });

  const enc = encodeURIComponent(email);

  // ══ Auto-borrado de la propia cuenta (creator o marca): libera el email para re-registro ══
  if (req.body && req.body.eliminar === true) {
    const H = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
    const del = (path) => fetch(`${SB_URL}/rest/v1/${path}`, { method: 'DELETE', headers: H });
    try {
      // Match exacto (eq), NO ilike: el '_' es comodín en SQL y borraría la cuenta equivocada.
      const cre = await sbGet(`creators?email=eq.${enc}&limit=1&select=id`);
      const mar = (cre && cre[0]) ? null : await sbGet(`marcas?email=eq.${enc}&limit=1&select=id`);
      if (cre && cre[0]) {
        await del(`conexiones?creator_id=eq.${encodeURIComponent(cre[0].id)}`).catch(() => {});
        await del(`creators?id=eq.${encodeURIComponent(cre[0].id)}`);
      } else if (mar && mar[0]) {
        await del(`marcas?id=eq.${encodeURIComponent(mar[0].id)}`);
      }
      // Borrar la cuenta de Auth (lo que libera el email)
      const u = await fetch(`${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null);
      const authId = u?.users?.[0]?.id || u?.[0]?.id || null;
      if (authId) await fetch(`${SB_URL}/auth/v1/admin/users/${authId}`, { method: 'DELETE', headers: H }).catch(() => {});
      return res.status(200).json({ ok: true, eliminado: true });
    } catch (err) {
      console.error('eliminar perfil error:', err);
      return res.status(500).json({ error: 'No se pudo eliminar la cuenta' });
    }
  }

  try {
    const cre = await sbGet(`creators?email=ilike.${enc}&limit=1&select=*`);
    if (cre && cre[0]) {
      const prof = cre[0];
      // Nunca mandar los tokens de MercadoPago al navegador (solo si está conectado)
      delete prof.mp_access_token;
      delete prof.mp_refresh_token;
      delete prof.mp_oauth_state;
      return res.status(200).json({ type: 'creator', profile: prof });
    }

    const mar = await sbGet(`marcas?email=ilike.${enc}&limit=1&select=*`);
    if (mar && mar[0]) return res.status(200).json({ type: 'marca', profile: mar[0] });

    return res.status(200).json({ type: null });
  } catch (err) {
    console.error('mi-perfil error:', err);
    return res.status(500).json({ error: err.message });
  }
}
