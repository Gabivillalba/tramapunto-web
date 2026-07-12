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

    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true, status: payment.status });
    }

    // Parsear external_reference (formato nuevo y viejo)
    const parts = (payment.external_reference || '').split('|');
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
