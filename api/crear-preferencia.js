// api/crear-preferencia.js  (v2)
// Crea la preferencia de pago en MercadoPago.
//
// NOVEDADES v2:
//   • El precio NO viene del front (antes se podía manipular). Se toma
//     de las env vars del servidor, fuente única de verdad.
//   • Soporta dos orígenes: 'bolsa' (desbloqueo del marketplace) y
//     'campania' (desbloqueo de un postulante).
//   • Primer desbloqueo de campaña de cada marca: GRATIS. Se registra
//     la conexión directamente, sin pasar por MercadoPago.
//
// Env vars: MP_ACCESS_TOKEN, SITE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY
// Los precios se leen de la tabla `config` (editables desde el admin),
// con fallback a env vars si la base no responde.

import { getPrecios } from './precios.js';

// ¿Esta marca ya desbloqueó algún contacto de campaña alguna vez?
async function yaUsoElGratis(marcaEmail) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/conexiones`
    + `?marca_email=eq.${encodeURIComponent(marcaEmail)}`
    + `&origen=eq.campania&estado=eq.pagado&select=id&limit=1`;
  const r = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!r.ok) return true;           // ante la duda, cobramos (fail-safe)
  const rows = await r.json();
  return rows.length > 0;
}

// Registrar una conexión sin pago (el desbloqueo bonificado)
async function registrarGratis({ creator_id, marca_email, marca_nombre, campania_id, postulacion_id }) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/conexiones`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      creator_id,
      marca_email,
      marca_nombre: marca_nombre || '',
      monto: 0,
      metodo: 'bonificado',
      voucher_id: 'primer-desbloqueo-gratis',
      estado: 'pagado',
      origen: 'campania',
      campania_id: campania_id || null,
      postulacion_id: postulacion_id || null,
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || 'No se pudo registrar el desbloqueo bonificado');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const {
    creator_id, creator_nombre, marca_email, marca_nombre,
    origen = 'bolsa',              // 'bolsa' | 'campania'
    campania_id, postulacion_id,
  } = req.body;

  if (!creator_id || !marca_email) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }
  if (!['bolsa', 'campania'].includes(origen)) {
    return res.status(400).json({ error: 'Origen inválido' });
  }

  try {
    // Precios actuales (de la tabla config, editable desde el admin)
    const PRECIOS = await getPrecios();

    // ── Primer desbloqueo de campaña: gratis ──
    if (origen === 'campania' && PRECIOS.primer_gratis) {
      const yaUso = await yaUsoElGratis(marca_email);
      if (!yaUso) {
        await registrarGratis({ creator_id, marca_email, marca_nombre, campania_id, postulacion_id });
        return res.status(200).json({
          gratis: true,
          mensaje: 'Primer desbloqueo bonificado por TRAMA.',
        });
      }
    }

    // ── Flujo de pago normal ──
    const precio = origen === 'campania' ? PRECIOS.precio_campania : PRECIOS.precio_bolsa;

    // external_reference lleva el contexto para que el webhook lo registre bien
    const extRef = [creator_id, marca_email, origen, campania_id || '', postulacion_id || ''].join('|');

    const titulo = origen === 'campania'
      ? `TRAMA. — Contacto de ${creator_nombre} (postulante)`
      : `TRAMA. — Conexión con ${creator_nombre}`;

    const successUrl = origen === 'campania'
      ? `${process.env.SITE_URL}/pago-exitoso.html?creator_id=${creator_id}&marca_email=${encodeURIComponent(marca_email)}&origen=campania&campania_id=${campania_id || ''}`
      : `${process.env.SITE_URL}/pago-exitoso.html?creator_id=${creator_id}&marca_email=${encodeURIComponent(marca_email)}&origen=bolsa`;

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          id: `${origen}-${creator_id}`,
          title: titulo,
          description: 'Acceso a datos de contacto verificados por TRAMA.',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: precio,        // ← del servidor, no del front
        }],
        payer: { email: marca_email, name: marca_nombre || '' },
        back_urls: {
          success: successUrl,
          failure: `${process.env.SITE_URL}/pago-fallido.html`,
          pending: `${process.env.SITE_URL}/pago-pendiente.html`,
        },
        auto_return: 'approved',
        external_reference: extRef,
        statement_descriptor: 'TRAMA.',
        notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Error en MercadoPago');

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      monto: precio,
    });

  } catch (error) {
    console.error('MP Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
