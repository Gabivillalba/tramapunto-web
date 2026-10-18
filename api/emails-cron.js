// api/emails-cron.js
// Procesa los envíos de email programados (tabla emails_programados) que ya
// vencieron. Lo dispara Vercel Cron. Requiere CRON_SECRET (igual que liga-cron).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, SITE_URL, CRON_SECRET

const SB_URL      = process.env.SUPABASE_URL;
const SB_SERVICE  = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL    = process.env.SITE_URL || 'https://www.tramapunto.com';
const CRON_SECRET = process.env.CRON_SECRET;

async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: method === 'PATCH' || method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `Supabase HTTP ${r.status}`); }
  return method === 'PATCH' || method === 'DELETE' ? null : r.json();
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emailWrap({ titulo, cuerpoHtml, ctaText, ctaHref }) {
  const cta = ctaText && ctaHref ? `<a href="${ctaHref}" style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:.12em;text-transform:uppercase;border-radius:2px;text-decoration:none;margin-top:8px">${ctaText}</a>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TRAMA.</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px"><tr><td align="center">
    <table width="100%" style="max-width:560px;background:#111;border:1px solid #1a1a1a;border-radius:4px;overflow:hidden">
      <tr><td style="background:#080808;padding:24px 32px;border-bottom:1px solid #1a1a1a">
        <span style="font-size:20px;font-weight:900;letter-spacing:.18em;color:#C8FF1A">TRAMA.</span>
      </td></tr>
      <tr><td style="padding:32px">
        ${titulo ? `<h1 style="margin:0 0 16px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;color:#F4F4EF">${titulo}</h1>` : ''}
        <div style="font-size:15px;color:#bbb;line-height:1.7">${cuerpoHtml}</div>
        ${cta}
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #1a1a1a;background:#0d0d0d">
        <p style="margin:0;font-size:11px;color:#555;line-height:1.6">© TRAMA. — Buenos Aires, Argentina<br>
          <a href="${SITE_URL}" style="color:#C8FF1A;text-decoration:none">tramapunto.com</a> ·
          <a href="mailto:info.tramapunto@gmail.com" style="color:#555;text-decoration:none">info.tramapunto@gmail.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function enviarBatch(dests, asunto, htmlFn) {
  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND) throw new Error('Falta RESEND_API_KEY');
  let enviados = 0;
  for (let i = 0; i < dests.length; i += 100) {
    const grupo = dests.slice(i, i + 100).map(d => ({
      from: 'TRAMA. <info@tramapunto.com>',
      reply_to: 'info.tramapunto@gmail.com',
      to: [String(d.email).trim()],
      subject: asunto,
      html: htmlFn(d.nombre),
    }));
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(grupo),
    });
    if (r.ok) { const j = await r.json().catch(() => ({})); enviados += (j.data && j.data.length) || grupo.length; }
  }
  return enviados;
}

// Arma la lista de destinatarios para un segmento (misma lógica que envio_masivo)
async function destinatarios(segmento) {
  let dests = [];
  const quiereCreators = segmento === 'creators_aprobados' || segmento === 'creators_todos' || segmento === 'todos';
  const quiereMarcas = segmento === 'marcas' || segmento === 'todos';
  if (quiereCreators) {
    const c = await sb('creators?select=nombre,email,status');
    let list = (c || []).filter(x => x.status !== 'rechazado');
    if (segmento === 'creators_aprobados') list = list.filter(x => x.status === 'aprobado');
    dests = dests.concat(list.map(x => ({ nombre: x.nombre, email: x.email })));
  }
  if (quiereMarcas) {
    const m = await sb('marcas?select=nombre,email');
    dests = dests.concat((m || []).map(x => ({ nombre: x.nombre, email: x.email })));
  }
  const seen = new Set();
  return dests.filter(d => {
    if (!d.email || !/@/.test(d.email)) return false;
    const e = d.email.trim().toLowerCase();
    if (seen.has(e)) return false;
    seen.add(e); return true;
  });
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const secret = (req.query && req.query.secret) || '';
  if (!CRON_SECRET) return res.status(500).json({ error: 'Falta CRON_SECRET en el entorno' });
  if (auth !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET) return res.status(401).json({ error: 'No autorizado' });

  try {
    const ahora = new Date().toISOString();
    const due = await sb(`emails_programados?estado=eq.pendiente&enviar_at=lte.${ahora}&select=*&order=enviar_at.asc&limit=20`);
    if (!due || !due.length) return res.status(200).json({ ok: true, procesados: 0 });

    const resultados = [];
    for (const job of due) {
      try {
        const dests = await destinatarios(job.segmento);
        const cuerpoBase = escapeHtml(job.cuerpo).replace(/\n/g, '<br>');
        const htmlFn = (nombre) => emailWrap({
          titulo: '',
          cuerpoHtml: `<p style="margin:0 0 16px">Hola <strong style="color:#F4F4EF">${escapeHtml(nombre) || 'crack'}</strong>,</p>` +
                      cuerpoBase.replace(/\{nombre\}/g, escapeHtml(nombre) || 'crack'),
          ctaText: 'Ir a TRAMA.', ctaHref: SITE_URL,
        });
        const enviados = dests.length ? await enviarBatch(dests, job.asunto, htmlFn) : 0;
        await sb(`emails_programados?id=eq.${job.id}`, 'PATCH', { estado: 'enviado', enviados, total: dests.length, sent_at: new Date().toISOString() });
        resultados.push({ id: job.id, enviados, total: dests.length });
      } catch (e) {
        await sb(`emails_programados?id=eq.${job.id}`, 'PATCH', { estado: 'error', error: String(e.message || e).slice(0, 300) });
        resultados.push({ id: job.id, error: String(e.message || e) });
      }
    }
    return res.status(200).json({ ok: true, procesados: due.length, resultados });
  } catch (err) {
    console.error('emails-cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
