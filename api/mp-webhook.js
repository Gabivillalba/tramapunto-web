// api/mp-webhook.js  (v2)
// Recibe notificaciones de MercadoPago y registra conexiones en Supabase.
//
// NOVEDAD v2: el external_reference ahora trae más contexto:
//   creator_id | marca_email | origen | campania_id | postulacion_id
// (las versiones viejas solo traían creator_id|marca_email — se siguen
//  soportando para no romper pagos en vuelo).

import crypto from 'node:crypto';
import { decrypt } from '../lib/mp-crypto.js';

// Desactivamos el body-parser de Vercel para poder leer el cuerpo crudo (raw):
// Paddle firma el HMAC sobre los bytes exactos del request. El flujo de
// MercadoPago sigue igual, pero toma el body desde `parsed` (JSON.parse del raw).
export const config = { api: { bodyParser: false } };

// Lee el cuerpo crudo del request y lo parsea. Defensivo: si por lo que sea
// Vercel ya dejó req.body poblado, lo reusamos (raw queda null → Paddle no
// podría verificar firma, pero MP nunca se rompe).
async function leerCuerpo(req) {
  const b = req.body;
  // Ya parseado por el runtime como objeto: lo usamos (sin raw → MP anda igual).
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    return { raw: null, parsed: b };
  }
  // El runtime dejó el cuerpo crudo como Buffer o string: lo aprovechamos.
  if (Buffer.isBuffer(b) || typeof b === 'string') {
    const raw = Buffer.isBuffer(b) ? b.toString('utf8') : b;
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
    return { raw, parsed };
  }
  // No hay body: leemos el stream nosotros.
  const chunks = [];
  try {
    for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  } catch { return { raw: null, parsed: {} }; }
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  return { raw, parsed };
}

// Valida la firma HMAC-SHA256 que MercadoPago envía en el header x-signature.
// Requiere MP_WEBHOOK_SECRET (la "clave secreta" del webhook, desde el panel de MP).
// Si no está configurada NO bloquea, para no romper notificaciones durante el rollout:
// apenas cargás el secret, la validación queda activa.
function firmaMpValida(req, parsed) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;                 // sin secret configurado todavía: no bloquea
  const sig = String(req.headers['x-signature'] || '');
  const reqId = String(req.headers['x-request-id'] || '');
  const parts = {};
  for (const kv of sig.split(',')) {
    const i = kv.indexOf('=');
    if (i !== -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const ts = parts.ts, v1 = parts.v1;
  if (!ts || !v1) return false;
  const q = req.query || {};
  let dataId = q['data.id'] ?? q.id ?? (parsed && parsed.data && parsed.data.id);
  dataId = dataId != null ? String(dataId) : '';
  if (/[a-zA-Z]/.test(dataId)) dataId = dataId.toLowerCase();
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const esperado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lee el pago desde MercadoPago. Primero con el token de TRAMA (marketplace); si
// falla (p. ej. un pago split cobrado por el creador que el token de TRAMA no puede
// leer), reintenta con los tokens de los creadores conectados hasta dar con el dueño.
async function obtenerPago(paymentId) {
  const trama = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
  });
  if (trama.ok) return trama.json();
  try {
    const H = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };
    const cres = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/creators?mp_conectado=eq.true&mp_access_token=not.is.null&select=mp_access_token&limit=200`,
      { headers: H }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    for (const c of cres) {
      let tok;
      try { tok = decrypt(c.mp_access_token); } catch { continue; }
      if (!tok) continue;
      const rr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (rr.ok) return rr.json();
    }
  } catch (e) {
    console.error('obtenerPago fallback error:', e);
  }
  return trama.json().catch(() => ({}));    // nada funcionó: devolvemos el intento original (no-ok)
}

// ── TRAMA. LABS: procesa un evento de suscripción (preapproval) ──
// Lee el preapproval de MP, mapea el estado y hace upsert por email en
// `suscripciones`. Avisa por notificación interna al activarse (nunca email).
// NOTA: el payload exacto de estos eventos conviene validarlo el 12/11 con un
// evento real de MercadoPago (sandbox o vivo) antes de empujar tráfico.
async function labsManejarSuscripcion(type, id) {
  if (!id) return;
  const H = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const mpH = { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` };

  let preId = id;
  if (type === 'subscription_authorized_payment') {
    const ap = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, { headers: mpH }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    preId = (ap && (ap.preapproval_id || ap.preapproval)) || null;
    if (!preId) return;
  }

  const pre = await fetch(`https://api.mercadopago.com/preapproval/${preId}`, { headers: mpH }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!pre) return;

  const email = (pre.external_reference || '').startsWith('labs|')
    ? pre.external_reference.slice(5)
    : (pre.payer_email || '');
  if (!email) return;

  const map = { authorized: 'activa', paused: 'pausada', cancelled: 'cancelada', pending: 'pausada' };
  const estado = map[pre.status] || 'pausada';
  const vig = pre.next_payment_date || new Date(Date.now() + 32 * 86400000).toISOString();

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/suscripciones?on_conflict=email`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ email, mp_preapproval_id: preId, estado, vigencia_hasta: vig, updated_at: new Date().toISOString() }),
  }).catch(() => {});

  if (estado === 'activa') {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/notificaciones`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ para_email: email, tipo: 'sistema', titulo: '🎓 ¡Bienvenido a TRAMA. LABS!', cuerpo: 'Tu suscripción está activa. Ya tenés acceso a todos los cursos, la biblioteca de prompts y el banco de recursos.', link: '/app.html' }),
    }).catch(() => {});
  }
}

// ── TRAMA. LABS (internacional): valida la firma de Paddle ──
// Paddle manda `Paddle-Signature: ts=...;h1=...`; el HMAC-SHA256 se calcula
// sobre `${ts}:${rawBody}` con el secret de la notification destination.
// Sin PADDLE_WEBHOOK_SECRET no bloquea (rollout); apenas lo cargás, se activa.
function firmaPaddleValida(raw, req) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return true;
  if (raw == null) return false;            // necesitamos el raw body para el HMAC
  const header = String(req.headers['paddle-signature'] || '');
  const parts = {};
  for (const kv of header.split(';')) {
    const i = kv.indexOf('=');
    if (i !== -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const ts = parts.ts, h1 = parts.h1;
  if (!ts || !h1) return false;
  const edad = Math.abs(Date.now() / 1000 - Number(ts));   // anti-replay (5 min)
  if (!Number.isFinite(edad) || edad > 300) return false;
  const esperado = crypto.createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(h1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── TRAMA. LABS (internacional): procesa un evento de suscripción de Paddle ──
// Upsert por email en `suscripciones` (procesador='paddle'). El email viene en
// custom_data (lo seteamos en el checkout); si no, lo pedimos a Paddle por API.
async function labsManejarPaddle(evt) {
  const tipo = evt && evt.event_type;
  if (!tipo) return;
  if (!tipo.startsWith('subscription.') && tipo !== 'transaction.completed') return;

  const d = (evt && evt.data) || {};
  const H = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

  let email = (d.custom_data && (d.custom_data.email || d.custom_data.Email)) || '';
  const subId = (d.id && String(d.id).startsWith('sub_')) ? d.id : (d.subscription_id || null);
  const customerId = d.customer_id || null;
  if (!email && customerId && process.env.PADDLE_API_KEY) {
    const base = (process.env.PADDLE_ENV === 'sandbox') ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
    const c = await fetch(`${base}/customers/${customerId}`, { headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    email = (c && c.data && c.data.email) || '';
  }
  if (!email) return;

  let estado = 'activa';
  if (tipo === 'subscription.canceled') estado = 'cancelada';
  else if (tipo === 'subscription.paused') estado = 'pausada';
  else if (d.status) {
    const map = { active: 'activa', trialing: 'activa', canceled: 'cancelada', paused: 'pausada', past_due: 'pausada' };
    estado = map[d.status] || 'activa';
  }
  const vig = (d.current_billing_period && d.current_billing_period.ends_at)
    || (d.billing_period && d.billing_period.ends_at)
    || d.next_billed_at
    || new Date(Date.now() + 32 * 86400000).toISOString();

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/suscripciones?on_conflict=email`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ email, procesador: 'paddle', paddle_subscription_id: subId, estado, vigencia_hasta: vig, updated_at: new Date().toISOString() }),
  }).catch(() => {});

  if (estado === 'activa') {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/notificaciones`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ para_email: email, tipo: 'sistema', titulo: '🎓 ¡Bienvenido a TRAMA. LABS!', cuerpo: 'Tu suscripción está activa. Ya tenés acceso a todos los cursos, la biblioteca de prompts y el banco de recursos.', link: '/app.html' }),
    }).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { raw, parsed } = await leerCuerpo(req);

  // ══ TRAMA. LABS (internacional) — webhook de Paddle ══
  // Se distingue por el header Paddle-Signature. Rama aislada del flujo MP.
  if (req.headers['paddle-signature']) {
    if (!firmaPaddleValida(raw, req)) {
      return res.status(401).json({ error: 'Firma Paddle inválida' });
    }
    try { await labsManejarPaddle(parsed); }
    catch (e) { console.error('paddle webhook error:', e); }
    return res.status(200).json({ received: true });
  }

  if (!firmaMpValida(req, parsed)) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  const { type, data } = parsed;

  // ══ TRAMA. LABS — eventos de suscripción (preapproval) ══
  if (type === 'subscription_preapproval' || type === 'subscription_authorized_payment') {
    try { await labsManejarSuscripcion(type, data && data.id); }
    catch (e) { console.error('labs sub webhook error:', e); }
    return res.status(200).json({ received: true });
  }

  if (type !== 'payment') {
    return res.status(200).json({ received: true });
  }

  try {
    // Verificar el pago con MercadoPago (token de TRAMA, con fallback al del creador)
    const payment = await obtenerPago(data.id);

    const esDevolucion = (payment.status === 'refunded' || payment.status === 'charged_back');
    if (payment.status !== 'approved' && !esDevolucion) {
      return res.status(200).json({ received: true, status: payment.status });
    }

    const parts = (payment.external_reference || '').split('|');
    const H = {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // ══ DEVOLUCIÓN / contracargo de un pago ══
    if (esDevolucion) {
      // Marcar la conexión (ledger) como devuelta
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/conexiones?voucher_id=eq.${encodeURIComponent(String(payment.id))}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'devuelto' }),
      }).catch(() => {});
      // Si era un trabajo de campaña, revertir la postulación y avisar a ambas partes
      if (parts[0] === 'trabajo') {
        const postulacion_id = parts[1];
        const creator_id = parts[2];
        if (postulacion_id) {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/postulaciones?id=eq.${encodeURIComponent(postulacion_id)}`, {
            method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
            body: JSON.stringify({ pago_estado: 'devuelto', estado: 'entregada' }),
          }).catch(() => {});
        }
        const cr = creator_id ? await fetch(`${process.env.SUPABASE_URL}/rest/v1/creators?id=eq.${encodeURIComponent(creator_id)}&select=email`, { headers: H }).then(r => r.ok ? r.json() : []).catch(() => []) : [];
        const cemail = cr && cr[0] && cr[0].email;
        if (cemail) await fetch(`${process.env.SUPABASE_URL}/rest/v1/notificaciones`, {
          method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ para_email: cemail, tipo: 'sistema', titulo: '↩️ Se devolvió un pago', cuerpo: 'Se procesó una devolución del pago de un trabajo de campaña. Si tenés dudas, escribinos.', link: '/perfil.html' }),
        }).catch(() => {});
      }
      return res.status(200).json({ received: true, refunded: true });
    }

    // ══ CARRITO: varios contactos de la bolsa desbloqueados en un solo pago ══
    if (parts[0] === 'carrito') {
      const cart_id = parts[1];
      if (!cart_id) return res.status(400).json({ error: 'Carrito inválido' });
      const carts = await fetch(`${process.env.SUPABASE_URL}/rest/v1/mp_carritos?id=eq.${encodeURIComponent(cart_id)}&select=marca_email,marca_nombre,creator_ids`, { headers: H }).then(r => r.ok ? r.json() : []).catch(() => []);
      const cart = carts && carts[0];
      if (!cart) return res.status(200).json({ received: true, cart: 'no encontrado' });
      const ids = Array.isArray(cart.creator_ids) ? cart.creator_ids : [];
      const marca_email = cart.marca_email || payment.payer?.email || '';
      const marca_nombre = cart.marca_nombre || payment.payer?.name || '';
      const montoUnit = ids.length ? Math.round(Number(payment.transaction_amount || 0) / ids.length) : Number(payment.transaction_amount || 0);
      for (const cid of ids) {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/conexiones`, {
          method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' },
          body: JSON.stringify({
            creator_id: cid, marca_email, marca_nombre,
            monto: montoUnit, metodo: payment.payment_type_id,
            voucher_id: String(payment.id), estado: 'pagado', origen: 'bolsa',
          }),
        }).catch(() => {});
      }
      return res.status(200).json({ received: true, recorded: ids.length, origen: 'carrito' });
    }

    // ══ Pago del TRABAJO de campaña (split): trabajo|postulacion_id|creator_id|campania_id ══
    if (parts[0] === 'trabajo') {
      const postulacion_id = parts[1];
      const trabajo_creator = parts[2] || null;
      const trabajo_campania = parts[3] || null;
      if (!postulacion_id) return res.status(400).json({ error: 'Referencia de trabajo inválida' });

      // Marcar la postulación como pagada
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/postulaciones?id=eq.${encodeURIComponent(postulacion_id)}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ estado: 'pagada', pago_estado: 'pagado', pago_id: String(payment.id), aprobado_at: new Date().toISOString() }),
      });
      // Registrar la conexión (ledger de dinero)
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/conexiones`, {
        method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({
          creator_id: trabajo_creator, marca_email: payment.payer?.email || '',
          marca_nombre: payment.payer?.name || '', monto: payment.transaction_amount,
          metodo: payment.payment_type_id, voucher_id: String(payment.id),
          estado: 'pagado', origen: 'trabajo', campania_id: trabajo_campania, postulacion_id,
        }),
      }).catch(() => {});
      // Avisar al creador que cobró
      if (trabajo_creator) {
        const cr = await fetch(`${process.env.SUPABASE_URL}/rest/v1/creators?id=eq.${encodeURIComponent(trabajo_creator)}&select=email`, { headers: H }).then(r => r.ok ? r.json() : []).catch(() => []);
        const cemail = cr && cr[0] && cr[0].email;
        if (cemail) {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/notificaciones`, {
            method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
            body: JSON.stringify({ para_email: cemail, tipo: 'sistema', titulo: '💸 ¡Cobraste un trabajo!', cuerpo: 'La marca aprobó tu video y el pago ya salió a tu MercadoPago.', link: '/perfil.html' }),
          }).catch(() => {});
        }
      }
      return res.status(200).json({ received: true, recorded: true, origen: 'trabajo' });
    }

    // Parsear external_reference (formato nuevo y viejo)
    const creator_id     = parts[0];
    const marca_email    = parts[1];
    const origen         = parts[2] || 'bolsa';         // default: compatibilidad
    const campania_id    = parts[3] || null;
    const postulacion_id = parts[4] || null;

    if (!creator_id || !marca_email) {
      return res.status(400).json({ error: 'Referencia inválida' });
    }

    const body = {
      creator_id,
      marca_email,
      marca_nombre: payment.payer?.name || payment.payer?.first_name || '',
      monto: payment.transaction_amount,
      metodo: payment.payment_type_id,
      voucher_id: String(payment.id),
      estado: 'pagado',
      origen,
    };
    if (campania_id)    body.campania_id    = campania_id;
    if (postulacion_id) body.postulacion_id = postulacion_id;

    const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/conexiones`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify(body),
    });

    if (!sbRes.ok) {
      const err = await sbRes.json().catch(() => ({}));
      throw new Error(err.message || 'Error guardando en Supabase');
    }

    return res.status(200).json({ received: true, recorded: true, origen });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
