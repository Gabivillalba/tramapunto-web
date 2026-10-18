// api/ver-perfil.js
// Registra una "vista de perfil": cuando alguien abre el detalle de un creador
// en la bolsa. Inserta con service_role (la tabla vistas_perfil no acepta
// escrituras desde la clave pública). Métrica de vanidad, sin datos sensibles;
// el FK a creators evita filas con creator_id inexistente.

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { creator_id } = req.body || {};
  if (!creator_id || typeof creator_id !== 'string') {
    return res.status(400).json({ error: 'Falta creator_id' });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/vistas_perfil`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE,
        Authorization: `Bearer ${SB_SERVICE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ creator_id }),
    });
    // Si el creator_id no existe, el FK rechaza: devolvemos ok:false sin ruido.
    return res.status(200).json({ ok: r.ok });
  } catch (err) {
    console.error('ver-perfil error:', err);
    return res.status(200).json({ ok: false });
  }
}
