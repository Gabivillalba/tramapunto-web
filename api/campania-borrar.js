// api/campania-borrar.js
// Acciones de la MARCA sobre sus campañas (verificadas por JWT + marca_email):
//   op 'borrar' (default): elimina una campaña propia.
//   op 'resultado': cierra una campaña con métricas para un creador.
// Corren con service_role; la identidad se verifica con el JWT del solicitante.
// (Un solo endpoint para no pasar el límite de funciones del plan.)

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
      Prefer: method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text().catch(() => '')));
  return method === 'DELETE' ? null : r.json();
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
  const op = b.op || 'borrar';

  try {
    // ── Cerrar campaña con resultados ──
    if (op === 'resultado') {
      const { campania_id, creator_id } = b;
      if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });
      if (!creator_id) return res.status(400).json({ error: 'Elegí el creador' });

      const camps = await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}&select=id,titulo,marca_email,marca_nombre`);
      const camp = camps && camps[0];
      if (!camp) return res.status(404).json({ error: 'Campaña no encontrada' });
      if (String(camp.marca_email || '').toLowerCase() !== marcaEmail) {
        return res.status(403).json({ error: 'Esta campaña no es tuya' });
      }

      const cres = await sb(`creators?id=eq.${encodeURIComponent(creator_id)}&select=id,nombre,apellido,email`);
      const cre = cres && cres[0];
      if (!cre) return res.status(404).json({ error: 'Creador no encontrado' });

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

      if (cre.email) {
        await sb('notificaciones', 'POST', {
          para_email: cre.email, tipo: 'sistema',
          titulo: '📊 Tenés resultados de una campaña',
          cuerpo: `${camp.marca_nombre || 'Una marca'} cargó los resultados de "${camp.titulo || 'una campaña'}". Miralos en tu panel.`,
          link: '/perfil.html',
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, resultado: inserted && inserted[0] ? inserted[0] : null });
    }

    // ── Seleccionar / descartar un postulante (marca) ──
    if (op === 'seleccionar' || op === 'rechazar') {
      const { postulacion_id } = b;
      if (!postulacion_id) return res.status(400).json({ error: 'Falta postulacion_id' });
      const ps = await sb(`postulaciones?id=eq.${encodeURIComponent(postulacion_id)}&select=id,campania_id,creador_id,tarifa_propuesta,estado`);
      const p = ps && ps[0];
      if (!p) return res.status(404).json({ error: 'Postulación no encontrada' });
      const camps = await sb(`campanias?id=eq.${encodeURIComponent(p.campania_id)}&select=id,titulo,marca_email,marca_nombre`);
      const camp = camps && camps[0];
      if (!camp || String(camp.marca_email || '').toLowerCase() !== marcaEmail) return res.status(403).json({ error: 'Esta campaña no es tuya' });
      if (op === 'seleccionar') {
        await sb(`postulaciones?id=eq.${encodeURIComponent(postulacion_id)}`, 'PATCH', { estado: 'aceptada', monto_acordado: numOrNull(p.tarifa_propuesta) });
        const cres = await sb(`creators?id=eq.${encodeURIComponent(p.creador_id)}&select=email`);
        const cemail = cres && cres[0] && cres[0].email;
        if (cemail) await sb('notificaciones', 'POST', { para_email: cemail, tipo: 'sistema', titulo: '✅ Te seleccionaron para una campaña', cuerpo: `${camp.marca_nombre || 'Una marca'} te seleccionó para "${camp.titulo || 'una campaña'}". Entrá a tu panel y subí el video cuando lo tengas listo.`, link: '/perfil.html' }).catch(() => {});
        return res.status(200).json({ ok: true, estado: 'aceptada' });
      }
      await sb(`postulaciones?id=eq.${encodeURIComponent(postulacion_id)}`, 'PATCH', { estado: 'rechazada' });
      return res.status(200).json({ ok: true, estado: 'rechazada' });
    }

    // ── Cerrar campaña: deja de aceptar postulantes (marca) ──
    if (op === 'cerrar') {
      const { campania_id } = b;
      if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });
      const camps = await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}&select=id,marca_email`);
      const camp = camps && camps[0];
      if (!camp || String(camp.marca_email || '').toLowerCase() !== marcaEmail) return res.status(403).json({ error: 'Esta campaña no es tuya' });
      await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}`, 'PATCH', { estado: 'cerrada' });
      return res.status(200).json({ ok: true, estado: 'cerrada' });
    }

    // ── Entregar video (creador) ──
    if (op === 'entregar') {
      const { postulacion_id, entrega_url } = b;
      if (!postulacion_id || !entrega_url) return res.status(400).json({ error: 'Falta el link del video' });
      if (!/^https?:\/\//i.test(entrega_url)) return res.status(400).json({ error: 'El link tiene que empezar con http' });
      const ps = await sb(`postulaciones?id=eq.${encodeURIComponent(postulacion_id)}&select=id,campania_id,creador_id,estado`);
      const p = ps && ps[0];
      if (!p) return res.status(404).json({ error: 'Postulación no encontrada' });
      const cres = await sb(`creators?id=eq.${encodeURIComponent(p.creador_id)}&select=id,email`);
      const cre = cres && cres[0];
      if (!cre || String(cre.email || '').toLowerCase() !== marcaEmail) return res.status(403).json({ error: 'Esta postulación no es tuya' });
      if (p.estado !== 'aceptada' && p.estado !== 'entregada') return res.status(400).json({ error: 'Todavía no te seleccionaron para esta campaña' });
      await sb(`postulaciones?id=eq.${encodeURIComponent(postulacion_id)}`, 'PATCH', { entrega_url: String(entrega_url).trim().slice(0, 500), entrega_at: new Date().toISOString(), estado: 'entregada' });
      const camps = await sb(`campanias?id=eq.${encodeURIComponent(p.campania_id)}&select=titulo,marca_email`);
      const camp = camps && camps[0];
      if (camp && camp.marca_email) await sb('notificaciones', 'POST', { para_email: camp.marca_email, tipo: 'sistema', titulo: '🎬 Un creador subió su video', cuerpo: `Hay una entrega lista para revisar en "${camp.titulo || 'tu campaña'}". Entrá a tu panel para verla y liberar el pago.`, link: '/perfil.html' }).catch(() => {});
      return res.status(200).json({ ok: true, estado: 'entregada' });
    }

    // ── Borrar campaña (default) ──
    const campania_id = b.campania_id;
    if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });
    const rows = await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}&select=id,marca_email`);
    const c = rows && rows[0];
    if (!c) return res.status(404).json({ error: 'Campaña no encontrada' });
    if (String(c.marca_email || '').toLowerCase() !== marcaEmail) {
      return res.status(403).json({ error: 'Esta campaña no es tuya' });
    }
    // FK seguras: postulaciones.campania_id = CASCADE, conexiones.campania_id = SET NULL
    await sb(`campanias?id=eq.${encodeURIComponent(campania_id)}`, 'DELETE');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('campania-borrar error:', err);
    return res.status(500).json({ error: err.message });
  }
}
