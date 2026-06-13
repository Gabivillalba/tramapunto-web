// api/crear-preferencia.js
// Vercel Serverless Function — corre en el servidor, nunca expone el Access Token

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { creator_id, creator_nombre, marca_email, marca_nombre } = req.body;

  if (!creator_id || !marca_email) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          id: `conexion-${creator_id}`,
          title: `TRAMA. — Conexión con ${creator_nombre}`,
          description: 'Acceso a datos de contacto verificados por TRAMA.',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: 4900,
        }],
        payer: {
          email: marca_email,
          name: marca_nombre || '',
        },
        back_urls: {
          success: `${process.env.SITE_URL}/pago-exitoso.html?creator_id=${creator_id}&marca_email=${encodeURIComponent(marca_email)}`,
          failure: `${process.env.SITE_URL}/pago-fallido.html`,
          pending: `${process.env.SITE_URL}/pago-pendiente.html`,
        },
        auto_return: 'approved',
        external_reference: `${creator_id}|${marca_email}`,
        statement_descriptor: 'TRAMA.',
        notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Error en MercadoPago');
    }

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,        // URL de pago real
      sandbox_init_point: data.sandbox_init_point, // URL de pago test
    });

  } catch (error) {
    console.error('MP Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
