// api/enviar-email.js
// Función centralizada para todos los emails de TRAMA.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = 'TRAMA. <info.tramapunto@gmail.com>';
const SITE_URL = process.env.SITE_URL || 'https://tramapunto-web.vercel.app';

// ── PLANTILLAS ──
function templateBase(contenido) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TRAMA.</title>
</head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#111;border:1px solid #1a1a1a;border-radius:4px;overflow:hidden">
        <!-- HEADER -->
        <tr><td style="background:#080808;padding:24px 32px;border-bottom:1px solid #1a1a1a">
          <span style="font-size:20px;font-weight:900;letter-spacing:0.18em;color:#C8FF1A">TRAMA.</span>
        </td></tr>
        <!-- CONTENIDO -->
        <tr><td style="padding:32px">
          ${contenido}
        </td></tr>
        <!-- FOOTER -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1a1a1a;background:#0d0d0d">
          <p style="margin:0;font-size:11px;color:#555;line-height:1.6">
            © 2025 TRAMA. — Buenos Aires, Argentina<br>
            <a href="${SITE_URL}" style="color:#C8FF1A;text-decoration:none">tramapunto.com.ar</a> · 
            <a href="mailto:info.tramapunto@gmail.com" style="color:#555;text-decoration:none">info.tramapunto@gmail.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const templates = {

  // 1. BIENVENIDA CREATOR
  bienvenida_creator: ({ nombre }) => ({
    subject: `Bienvenido/a a TRAMA., ${nombre} 🎉`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        ¡Hola, ${nombre}!
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#C8FF1A;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
        Tu perfil fue recibido
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#999;line-height:1.7">
        Gracias por sumarte a <strong style="color:#F4F4EF">TRAMA.</strong> Tu perfil está en revisión. 
        El equipo lo va a analizar y en las próximas <strong style="color:#F4F4EF">48-72 horas hábiles</strong> 
        te avisamos si quedás en la bolsa.
      </p>
      <p style="margin:0 0 28px;font-size:15px;color:#999;line-height:1.7">
        Mientras tanto, podés completar tu perfil para aumentar tus chances de aprobación.
      </p>
      <a href="${SITE_URL}/perfil.html" 
         style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">
        Completar mi perfil →
      </a>
    `)
  }),

  // 2. BIENVENIDA MARCA
  bienvenida_marca: ({ nombre, tipo }) => ({
    subject: `Bienvenido/a a TRAMA., ${nombre}`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        ¡Hola, ${nombre}!
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#C8FF1A;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
        Tu cuenta está activa
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#999;line-height:1.7">
        Ya sos parte de <strong style="color:#F4F4EF">TRAMA.</strong> ${
          tipo === 'corporativa' 
          ? 'El equipo de TRAMA. va a revisar tu solicitud y te contactará para coordinar la reunión de briefing.'
          : 'Ya podés explorar nuestra bolsa de creators verificados y conectarte con los que mejor hagan fit con tu marca.'
        }
      </p>
      <a href="${SITE_URL}/${tipo === 'corporativa' ? '' : ''}" 
         style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">
        ${tipo === 'corporativa' ? 'Ir al inicio →' : 'Explorar creators →'}
      </a>
    `)
  }),

  // 3. CREATOR APROBADO
  creator_aprobado: ({ nombre }) => ({
    subject: `✅ Tu perfil fue aprobado en TRAMA.`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        ¡Estás dentro, ${nombre}!
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#C8FF1A;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
        Perfil aprobado ✓
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#999;line-height:1.7">
        Tu perfil fue revisado y aprobado por el equipo de <strong style="color:#F4F4EF">TRAMA.</strong> 
        A partir de ahora estás visible en la bolsa de creators y las marcas pueden encontrarte y conectarse con vos.
      </p>
      <p style="margin:0 0 28px;font-size:15px;color:#999;line-height:1.7">
        Cuando una marca pague para contactarte, te avisamos por email con todos los detalles.
      </p>
      <a href="${SITE_URL}/perfil.html" 
         style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">
        Ver mi perfil →
      </a>
    `)
  }),

  // 4. CREATOR RECHAZADO
  creator_rechazado: ({ nombre, nota }) => ({
    subject: `Actualización sobre tu perfil en TRAMA.`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        Hola, ${nombre}
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#ff4444;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
        Sobre tu perfil
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#999;line-height:1.7">
        Revisamos tu perfil y por el momento no cumple con los requisitos de <strong style="color:#F4F4EF">TRAMA.</strong> 
        para ser parte de nuestra bolsa de creators.
      </p>
      ${nota ? `
      <div style="background:#1a0000;border:1px solid #2a0000;border-left:3px solid #ff4444;border-radius:2px;padding:16px;margin-bottom:20px">
        <p style="margin:0;font-size:13px;color:#ff8888;line-height:1.6">
          <strong style="color:#F4F4EF">Nota del equipo:</strong> ${nota}
        </p>
      </div>` : ''}
      <p style="margin:0 0 28px;font-size:15px;color:#999;line-height:1.7">
        Si querés más información o creés que hubo un error, escribinos directamente y lo revisamos.
      </p>
      <a href="mailto:info.tramapunto@gmail.com" 
         style="display:inline-block;background:#1a1a1a;color:#F4F4EF;border:1px solid #2a2a2a;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">
        Contactar al equipo →
      </a>
    `)
  }),

  // 5. COMPROBANTE DE PAGO (marca)
  comprobante_pago: ({ marca_nombre, creator_nombre, monto, fecha, payment_id }) => ({
    subject: `Comprobante de conexión · TRAMA. — ${creator_nombre}`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        Conexión desbloqueada
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#C8FF1A;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
        Pago aprobado ✓
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#999;line-height:1.7">
        Hola <strong style="color:#F4F4EF">${marca_nombre}</strong>, tu pago fue procesado correctamente. 
        Ya tenés acceso a los datos de contacto de <strong style="color:#F4F4EF">${creator_nombre}</strong>.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:3px;margin-bottom:24px">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #161616">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#C8FF1A">COMPROBANTE</span>
        </td></tr>
        <tr><td style="padding:0">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:10px 16px;border-bottom:1px solid #0f0f0f;font-size:13px;color:#666">Creator</td>
              <td style="padding:10px 16px;border-bottom:1px solid #0f0f0f;font-size:13px;color:#F4F4EF;text-align:right;font-weight:700">${creator_nombre}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;border-bottom:1px solid #0f0f0f;font-size:13px;color:#666">Monto</td>
              <td style="padding:10px 16px;border-bottom:1px solid #0f0f0f;font-size:13px;color:#C8FF1A;text-align:right;font-weight:900">$${monto} ARS</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;border-bottom:1px solid #0f0f0f;font-size:13px;color:#666">Fecha</td>
              <td style="padding:10px 16px;border-bottom:1px solid #0f0f0f;font-size:13px;color:#F4F4EF;text-align:right">${fecha}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:13px;color:#666">ID de pago</td>
              <td style="padding:10px 16px;font-size:12px;color:#555;text-align:right">${payment_id || '—'}</td>
            </tr>
          </table>
        </td></tr>
      </table>
      <div style="background:#0f1a00;border:1px solid #1a3000;border-radius:3px;padding:16px;margin-bottom:24px">
        <p style="margin:0;font-size:13px;color:#999;line-height:1.6">
          📋 <strong style="color:#F4F4EF">Próximo paso:</strong> contactá a ${creator_nombre} directamente 
          y presentate como marca de TRAMA. para una mejor recepción.
        </p>
      </div>
      <a href="${SITE_URL}" 
         style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">
        Ver más creators →
      </a>
    `)
  }),

  // 6. NOTIFICACIÓN AL CREATOR (lo contactaron)
  notificacion_contacto: ({ creator_nombre, marca_nombre, marca_email }) => ({
    subject: `¡Una marca quiere conectar con vos en TRAMA.!`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        ¡Tenés una conexión nueva!
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#c084fc;font-weight:700;letter-spacing:0.1em;text-transform:uppercase">
        Una marca te contactó
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#999;line-height:1.7">
        Hola <strong style="color:#F4F4EF">${creator_nombre}</strong>, 
        <strong style="color:#F4F4EF">${marca_nombre}</strong> pagó para acceder a tus datos de contacto en TRAMA.
      </p>
      <div style="background:#1a0a2a;border:1px solid #3a1a5a;border-radius:3px;padding:16px;margin-bottom:24px">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#c084fc">Datos de la marca</p>
        <p style="margin:0;font-size:14px;color:#F4F4EF;font-weight:700">${marca_nombre}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#999">${marca_email}</p>
      </div>
      <p style="margin:0 0 28px;font-size:15px;color:#999;line-height:1.7">
        Esperá que te contacten directamente o tomá la iniciativa y escribiles vos primero.
      </p>
      <a href="${SITE_URL}/perfil.html" 
         style="display:inline-block;background:#c084fc;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">
        Ver mi perfil →
      </a>
    `)
  }),

  // 7. RESET DE CONTRASEÑA
  reset_password: ({ nombre, reset_url }) => ({
    subject: `Reseteo de contraseña · TRAMA.`,
    html: templateBase(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.02em;color:#F4F4EF">
        Reseteo de contraseña
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#999;line-height:1.7">
        Hola <strong style="color:#F4F4EF">${nombre || 'ahí'}</strong>, recibimos una solicitud para resetear 
        la contraseña de tu cuenta en TRAMA. Si no fuiste vos, ignorá este email.
      </p>
      <a href="${reset_url}" 
         style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;border-radius:2px;text-decoration:none;margin-bottom:20px">
        Resetear contraseña →
      </a>
      <p style="margin:20px 0 0;font-size:12px;color:#555;line-height:1.6">
        Este link expira en 24 horas. Si no solicitaste este cambio, tu cuenta está segura y podés ignorar este email.
      </p>
    `)
  }),

};

// ── HANDLER PRINCIPAL ──
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { tipo, to, data } = req.body;

  if (!tipo || !to) {
    return res.status(400).json({ error: 'Faltan tipo y destinatario' });
  }

  const template = templates[tipo];
  if (!template) {
    return res.status(400).json({ error: `Tipo de email desconocido: ${tipo}` });
  }

  const { subject, html } = template(data || {});

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Error en Resend');
    }

    return res.status(200).json({ sent: true, id: result.id });

  } catch (error) {
    console.error('Email error:', error);
    return res.status(500).json({ error: error.message });
  }
}
