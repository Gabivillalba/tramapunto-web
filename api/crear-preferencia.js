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
import { decrypt } from '../lib/mp-crypto.js';
const DIAS_ACCESO = 60;

// ¿La marca YA tiene acceso vigente (≤60 días) a ESTE contacto? (cualquier origen)
// Evita que se cobre dos veces el mismo contacto dentro del período de acceso.
async function yaTieneAcceso(marcaEmail, creatorId) {
  const desde = new Date(Date.now() - DIAS_ACCESO * 86400000).toISOString();
  const url = `${process.env.SUPABASE_URL}/rest/v1/conexiones`
    + `?marca_email=ilike.${encodeURIComponent(marcaEmail)}`
    + `&creator_id=eq.${encodeURIComponent(creatorId)}`
    + `&estado=eq.pagado&created_at=gte.${encodeURIComponent(desde)}`
    + `&select=id&limit=1`;
  const r = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!r.ok) return false;              // ante la duda NO bloqueamos la compra
  const rows = await r.json();
  return rows.length > 0;
}

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

  if (!marca_email || (origen !== 'carrito' && !creator_id)) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }
  if (!['bolsa', 'campania', 'trabajo', 'carrito'].includes(origen)) {
    return res.status(400).json({ error: 'Origen inválido' });
  }

  try {
    // ══ CARRITO: desbloqueo de varios contactos de la bolsa en un solo pago ══
    if (origen === 'carrito') {
      const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
      let ids = Array.isArray(req.body.creator_ids) ? req.body.creator_ids.filter(Boolean).map(String) : [];
      ids = [...new Set(ids)];
      if (!ids.length) return res.status(400).json({ error: 'El carrito está vacío' });

      // Solo creadores aprobados existentes
      const cres = await fetch(`${SB}/rest/v1/creators?id=in.(${ids.map(encodeURIComponent).join(',')})&status=eq.aprobado&select=id`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then(r => r.ok ? r.json() : []);
      const validos = (cres || []).map(c => String(c.id));

      // Quitar los que la marca ya tiene acceso vigente (no se cobran de nuevo)
      const aCobrar = [];
      for (const id of validos) { if (!(await yaTieneAcceso(marca_email, id))) aCobrar.push(id); }
      if (!aCobrar.length) {
        return res.status(200).json({ yaComprado: true, mensaje: 'Ya tenés acceso a todos los contactos del carrito.' });
      }

      const PRECIOS = await getPrecios();
      const total = PRECIOS.precio_bolsa * aCobrar.length;

      // Guardar el carrito para que el webhook registre todas las conexiones
      const ins = await fetch(`${SB}/rest/v1/mp_carritos`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ marca_email, marca_nombre: marca_nombre || '', creator_ids: aCobrar, monto: total }),
      });
      const cartRows = await ins.json().catch(() => []);
      const cart = Array.isArray(cartRows) ? cartRows[0] : cartRows;
      if (!ins.ok || !cart || !cart.id) throw new Error('No se pudo crear el carrito');

      const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: `carrito-${cart.id}`, title: `TRAMA. — ${aCobrar.length} contacto${aCobrar.length > 1 ? 's' : ''} de creadores`, description: 'Acceso a datos de contacto verificados por TRAMA.', quantity: 1, currency_id: 'ARS', unit_price: total }],
          payer: { email: marca_email, name: marca_nombre || '' },
          back_urls: {
            success: `${process.env.SITE_URL}/pago-exitoso.html?origen=carrito`,
            failure: `${process.env.SITE_URL}/pago-fallido.html`,
            pending: `${process.env.SITE_URL}/pago-pendiente.html`,
          },
          auto_return: 'approved',
          external_reference: `carrito|${cart.id}`,
          statement_descriptor: 'TRAMA.',
          notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error en MercadoPago');
      return res.status(200).json({ id: data.id, init_point: data.init_point, sandbox_init_point: data.sandbox_init_point, monto: total, cantidad: aCobrar.length });
    }

    // ══ PAGO DEL TRABAJO DE CAMPAÑA (split 90/10 al creador) ══
    if (origen === 'trabajo') {
      const { postulacion_id } = req.body;
      if (!postulacion_id) return res.status(400).json({ error: 'Falta la postulación' });
      const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
      const q = async (p) => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }); return r.ok ? r.json() : []; };

      const ps = await q(`postulaciones?id=eq.${encodeURIComponent(postulacion_id)}&select=id,campania_id,creador_id,estado,monto_acordado,tarifa_propuesta,pago_estado`);
      const p = ps && ps[0];
      if (!p) return res.status(404).json({ error: 'Postulación no encontrada' });
      if (p.pago_estado === 'pagado') return res.status(200).json({ yaComprado: true, mensaje: 'Este trabajo ya está pagado.' });
      if (p.estado !== 'entregada') return res.status(400).json({ error: 'El creador todavía no entregó el video.' });

      const camps = await q(`campanias?id=eq.${encodeURIComponent(p.campania_id)}&select=id,titulo,marca_email`);
      const camp = camps && camps[0];
      if (!camp || String(camp.marca_email || '').toLowerCase() !== String(marca_email || '').toLowerCase()) {
        return res.status(403).json({ error: 'Esta campaña no es tuya' });
      }

      const cres = await q(`creators?id=eq.${encodeURIComponent(p.creador_id)}&select=id,nombre,mp_conectado,mp_access_token`);
      const cre = cres && cres[0];
      if (!cre || !cre.mp_conectado || !cre.mp_access_token) {
        return res.status(200).json({ error: 'El creador todavía no conectó su MercadoPago. Avisale que lo conecte desde su panel así podés pagarle.' });
      }

      const monto = Number(p.monto_acordado || p.tarifa_propuesta || 0);
      if (!monto || monto <= 0) return res.status(400).json({ error: 'Falta el monto acordado con el creador.' });
      const fee = Math.max(1, Math.round(monto * 0.10));            // comisión TRAMA 10%
      const extRef = ['trabajo', postulacion_id, p.creador_id, p.campania_id || ''].join('|');

        const creatorToken = decrypt(cre.mp_access_token);            // tokens guardados cifrados (AES-256-GCM)
      if (!creatorToken) return res.status(200).json({ error: 'No se pudo leer la conexión de MercadoPago del creador. Pedile que la reconecte desde su panel.' });

      const pref = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${creatorToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: `trabajo-${postulacion_id}`, title: `TRAMA. — ${camp.titulo || 'Campaña'} · trabajo de ${cre.nombre || 'creador'}`, quantity: 1, currency_id: 'ARS', unit_price: monto }],
          marketplace_fee: fee,
          payer: { email: marca_email },
          back_urls: {
            success: `${process.env.SITE_URL}/pago-exitoso.html?origen=trabajo`,
            failure: `${process.env.SITE_URL}/pago-fallido.html`,
            pending: `${process.env.SITE_URL}/pago-pendiente.html`,
          },
          auto_return: 'approved',
          external_reference: extRef,
          statement_descriptor: 'TRAMA.',
          notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
        }),
      });
      const pd = await pref.json();
      if (!pref.ok) throw new Error(pd.message || 'Error en MercadoPago (split)');
      return res.status(200).json({ id: pd.id, init_point: pd.init_point, sandbox_init_point: pd.sandbox_init_point, monto });
    }

    // ── Ya tiene acceso vigente a este contacto: no se cobra de nuevo ──
    if (await yaTieneAcceso(marca_email, creator_id)) {
      return res.status(200).json({
        yaComprado: true,
        mensaje: 'Ya tenés acceso a este contacto (vigente por 60 días). Lo ves en “Mis conexiones”.',
      });
    }

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
