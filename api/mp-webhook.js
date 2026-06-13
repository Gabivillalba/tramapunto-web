// api/mp-webhook.js
// Recibe notificaciones de MercadoPago y registra conexiones en Supabase

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { type, data } = req.body;

  // Solo procesar pagos aprobados
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

    // Extraer creator_id y marca_email de external_reference
    const [creator_id, marca_email] = (payment.external_reference || '').split('|');
    if (!creator_id || !marca_email) {
      return res.status(400).json({ error: 'Referencia inválida' });
    }

    // Registrar conexión en Supabase
    const sbRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/conexiones`, {
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
        marca_nombre: payment.payer?.name || '',
        monto: payment.transaction_amount,
        metodo: payment.payment_type_id,
        voucher_id: String(payment.id),
        estado: 'pagado',
      }),
    });

    if (!sbRes.ok) {
      const err = await sbRes.json();
      throw new Error(err.message || 'Error guardando en Supabase');
    }

    return res.status(200).json({ received: true, recorded: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
