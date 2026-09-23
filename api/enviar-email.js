// api/enviar-email.js
// Envío de emails transaccionales de TRAMA. vía Resend.
//
// Contrato (lo que ya usa api/admin.js):
//   POST { tipo, to, data }
//     tipo → clave de plantilla (ver PLANTILLAS abajo)
//     to   → email destino
//     data → variables de la plantilla (nombre, titulo, nota, ...)
//
// Variables de entorno necesarias en Vercel:
//   RESEND_API_KEY → API key de Resend
//   SITE_URL       → https://www.tramapunto.com
//
// NOTA de dominio: Resend solo envía desde un dominio verificado.
// Verificá tramapunto.com en Resend (DNS en GoDaddy) y usá un from
// de ese dominio. Para probar antes de verificar, podés usar
// 'onboarding@resend.dev' como FROM temporal.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE_URL       = process.env.SITE_URL || 'https://www.tramapunto.com';

const FROM     = 'Gabi de TRAMA. <hola@tramapunto.com>'; // ← dominio verificado en Resend
const REPLY_TO = 'info.tramapunto@gmail.com';            // las respuestas te llegan acá
const IG_URL   = 'https://instagram.com/trama.punto';    // ← ajustá al handle real
const CALENDLY = 'https://calendly.com/villalba-cgabriel/30min';

// — Colores de marca —
const NEGRO = '#0A0A0A';
const VERDE = '#C8FF1A';

// Layout compartido: header negro con wordmark verde, cuerpo claro, botón verde.
function layout({ titulo, cuerpoHtml, ctaTexto, ctaUrl }) {
  const boton = ctaTexto && ctaUrl
    ? `<tr><td style="padding:8px 0 4px;">
         <a href="${ctaUrl}"
            style="display:inline-block;background:${VERDE};color:${NEGRO};
                   text-decoration:none;font-weight:800;font-size:15px;
                   padding:14px 26px;border-radius:8px;">${ctaTexto}</a>
       </td></tr>`
    : '';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${NEGRO};padding:22px 32px;">
          <span style="color:${VERDE};font-size:22px;font-weight:900;letter-spacing:-0.5px;">TRAMA.</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:${NEGRO};">${titulo}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="font-size:16px;line-height:1.55;color:#2a2a2a;">
            ${cuerpoHtml}
            ${boton}
          </table>
          <p style="margin:28px 0 0;font-size:16px;color:#2a2a2a;">— Gabi · TRAMA.</p>
        </td></tr>
        <tr><td style="background:#fafafa;padding:18px 32px;border-top:1px solid #ececec;
                       font-size:12px;color:#999;">
          TRAMA. — conectamos marcas con creadores de contenido.
          <a href="${SITE_URL}" style="color:#999;">tramapunto.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const p = (txt) => `<tr><td style="padding:0 0 14px;">${txt}</td></tr>`;

// — Plantillas —
const PLANTILLAS = {

  // Creador — bienvenida (al registrarse). Disparalo desde el flujo de registro.
  creator_bienvenida: (d) => ({
    subject: `Recibimos tu perfil, ${d.nombre || ''}`.trim(),
    html: layout({
      titulo: `Recibimos tu perfil${d.nombre ? ', ' + d.nombre : ''}`,
      cuerpoHtml:
        p(`Hola${d.nombre ? ' ' + d.nombre : ''}, soy Gabi, de TRAMA. Te sumaste como creador/a y quería agradecerte que confíes.`) +
        p(`Estamos revisando tu perfil a mano —sí, lo miramos de verdad, uno por uno—. En cuanto quede aprobado te aviso y vas a aparecer en la bolsa para que las marcas te encuentren.`) +
        p(`Mientras tanto, seguinos en Instagram: ahí mostramos cómo trabajamos y las oportunidades que van saliendo.`),
      ctaTexto: 'Seguir a TRAMA. en Instagram',
      ctaUrl: IG_URL,
    }),
  }),

  // Creador — aprobación (lo dispara admin.js al pasar a 'aprobado').
  creator_aprobado: (d) => ({
    subject: `Estás dentro, ${d.nombre || ''}`.trim(),
    html: layout({
      titulo: `Estás dentro${d.nombre ? ', ' + d.nombre : ''}`,
      cuerpoHtml:
        p(`${d.nombre ? d.nombre + ', tu' : 'Tu'} perfil quedó aprobado. Ya sos parte de la bolsa de TRAMA. y las marcas pueden encontrarte.`) +
        p(`El próximo paso es tuyo: entrá a las oportunidades abiertas y postulate a las que van con vos. Cuanto más completa la postulación, más chances.`) +
        p(`Cualquier cosa, me escribís.`),
      ctaTexto: 'Ver oportunidades abiertas',
      ctaUrl: `${SITE_URL}/oportunidades.html`,
    }),
  }),

  // Creador — rechazo (lo dispara admin.js al pasar a 'rechazado').
  creator_rechazado: (d) => ({
    subject: `Sobre tu perfil en TRAMA.`,
    html: layout({
      titulo: `Sobre tu perfil${d.nombre ? ', ' + d.nombre : ''}`,
      cuerpoHtml:
        p(`Hola${d.nombre ? ' ' + d.nombre : ''}, gracias por postularte a TRAMA. Por ahora no vamos a avanzar con tu perfil.`) +
        (d.nota ? p(`<strong>Motivo:</strong> ${d.nota}`) : '') +
        p(`No lo tomes como un no definitivo: podés completar o mejorar tu perfil y volver a postularte cuando quieras. Estamos para ayudarte.`),
      ctaTexto: 'Actualizar mi perfil',
      ctaUrl: `${SITE_URL}/perfil.html`,
    }),
  }),

  // Marca — bienvenida (al registrarse). Disparalo desde el flujo de marcas.
  marca_bienvenida: (d) => ({
    subject: `Bienvenida a TRAMA.${d.nombre ? ', ' + d.nombre : ''}`,
    html: layout({
      titulo: `Bienvenida a TRAMA.${d.nombre ? ', ' + d.nombre : ''}`,
      cuerpoHtml:
        p(`Hola, soy Gabi, de TRAMA. Gracias por registrar${d.nombre ? ' a ' + d.nombre : 'te'}.`) +
        p(`Te cuento en dos líneas cómo funciona: publicás una campaña, te llegan creadores reales postulándose, y desbloqueás el contacto de los que más te cierran. <strong>La primera campaña la desbloqueás gratis</strong>, así la probás sin costo.`) +
        p(`Si preferís que te lo muestre en vivo, agendamos una llamada y lo vemos juntos: <a href="${CALENDLY}" style="color:${NEGRO};">agendar acá</a>.`),
      ctaTexto: 'Crear tu primera campaña',
      ctaUrl: `${SITE_URL}/campanas.html`,
    }),
  }),

  // Marca — campaña activada (lo dispara admin.js al pasar la campaña a 'activa').
  campania_activa: (d) => ({
    subject: `${d.titulo ? '"' + d.titulo + '"' : 'Tu campaña'} ya está activa`,
    html: layout({
      titulo: `${d.nombre ? d.nombre + ', tu' : 'Tu'} campaña ya está activa`,
      cuerpoHtml:
        p(`Listo${d.nombre ? ', ' + d.nombre : ''}: ${d.titulo ? '<strong>' + d.titulo + '</strong>' : 'tu campaña'} quedó publicada en TRAMA. y ya puede empezar a recibir postulaciones de creadores.`) +
        p(`Te vamos avisando a medida que lleguen. Si querés que te dé una mano afinando el brief para que lleguen las postulaciones correctas, decime y lo vemos.`),
      ctaTexto: 'Ver mi campaña',
      ctaUrl: `${SITE_URL}/panel-marca.html`,
    }),
  }),
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Falta RESEND_API_KEY' });
  }

  const { tipo, to, data = {} } = req.body || {};
  if (!tipo || !to) {
    return res.status(400).json({ error: 'Faltan tipo/to' });
  }

  const plantilla = PLANTILLAS[tipo];
  if (!plantilla) {
    return res.status(400).json({ error: `Tipo de email desconocido: ${tipo}` });
  }

  const { subject, html } = plantilla(data);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to,
        reply_to: REPLY_TO,
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `Resend HTTP ${r.status}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('enviar-email error:', err);
    return res.status(500).json({ error: err.message });
  }
}
