// api/mp-webhook.js  (v2)
// Recibe notificaciones de MercadoPago y registra conexiones en Supabase.
//
// NOVEDAD v2: el external_reference ahora trae más contexto:
//   creator_id | marca_email | origen | campania_id | postulacion_id
// (las versiones viejas solo traían creator_id|marca_email — se siguen
//  soportando para no romper pagos en vuelo).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { type, data } = req.body;
  if (type !== 'payment') {
    return res.status(200).json({ received: true });
  }

  try {
    // Verificar el pago con MercadoPago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const payment = await mpRes.json();

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
