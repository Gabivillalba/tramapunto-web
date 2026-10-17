// api/liga-cron.js
// Cron de la Liga TRAMA. Corre 1 vez por día (Vercel Cron).
//   • Los LUNES manda el mail con la agenda de la semana a los creadores.
//   • El día 1 del mes (o el primer run del mes nuevo) cierra la temporada:
//     corona al 👑 campeón, lo guarda en liga_historial, le da ×2 el mes
//     siguiente y reinicia los puntos de todos (la racha se mantiene).
//
// Seguridad: requiere CRON_SECRET. Vercel Cron manda 'Authorization: Bearer
// <CRON_SECRET>' automáticamente si esa env var existe. Para probar a mano:
//   https://www.tramapunto.com/api/liga-cron?secret=TU_SECRET&force=1
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, SITE_URL, CRON_SECRET

import { hoyART, semanaDeMisiones } from './liga.js';

const SB_URL        = process.env.SUPABASE_URL;
const SB_SERVICE    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const CRON_SECRET   = process.env.CRON_SECRET;
const SITE_URL      = process.env.SITE_URL || 'https://www.tramapunto.com';
const FROM          = 'TRAMA. <info@tramapunto.com>';   // dominio verificado en Resend
const REPLY_TO      = 'info.tramapunto@gmail.com';       // respuestas a la casilla real

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIA   = { Mon:'Lunes', Tue:'Martes', Wed:'Miércoles', Thu:'Jueves', Fri:'Viernes', Sat:'Sábado', Sun:'Domingo' };
const TIPO  = { reto:'🎬 Reto creativo', trivia:'🧠 Trivia', tendencia:'📈 Tendencia', libre:'🌙 Día libre' };

function mesNombre(ym){ const m = parseInt((ym||'').slice(5,7),10); return MESES[(m-1+12)%12] || ''; }

async function sb(path, method='GET', body=null){
  const opts = {
    method,
    headers:{
      'apikey': SB_SERVICE,
      'Authorization': `Bearer ${SB_SERVICE}`,
      'Content-Type':'application/json',
      'Prefer': method==='PATCH' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok){ const e = await r.json().catch(()=>({})); throw new Error(e.message || `Supabase HTTP ${r.status}`); }
  return method==='PATCH' ? null : r.json();
}

// ───────── MAIL SEMANAL ─────────
function emailSemana(nombre, dias){
  const filas = dias.map(d=>`
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #161616;font-size:12px;font-weight:700;color:#C8FF1A;white-space:nowrap;vertical-align:top">${DIA[d.wd]||d.wd}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #161616;vertical-align:top">
        <span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#777">${TIPO[d.tipo]||d.tipo}</span><br>
        <span style="font-size:13px;color:#F4F4EF;line-height:1.5">${d.contenido || 'Descansá o preparate para la semana.'}</span>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TRAMA.</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px"><tr><td align="center">
    <table width="100%" style="max-width:560px;background:#111;border:1px solid #1a1a1a;border-radius:4px;overflow:hidden">
      <tr><td style="background:#080808;padding:24px 32px;border-bottom:1px solid #1a1a1a">
        <span style="font-size:20px;font-weight:900;letter-spacing:.18em;color:#C8FF1A">TRAMA.</span>
      </td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0 0 8px;font-size:13px;color:#C8FF1A;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Liga TRAMA. 🔥</p>
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;color:#F4F4EF">Tu semana de desafíos</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#999;line-height:1.7">
          Hola <strong style="color:#F4F4EF">${nombre || 'crack'}</strong>, estos son los desafíos de esta semana.
          Entrá cada día, cumplí la misión y <strong style="color:#F4F4EF">no cortes la racha</strong> para subir en la bolsa.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:3px;margin-bottom:24px">${filas}</table>
        <a href="${SITE_URL}/perfil.html" style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">Ir a la Liga →</a>
        <p style="margin:24px 0 0;font-size:12px;color:#555;line-height:1.6">A fin de mes se corona al #1 y arranca una liga nueva. El campeón arranca con puntos dobles.</p>
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

function chunk(arr, n){ const out=[]; for (let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }

async function enviarMailSemanal(iso){
  if (!RESEND_KEY) return 'sin RESEND_API_KEY';
  const dias = await semanaDeMisiones(iso, iso);
  const creators = await sb(`creators?select=nombre,email,status`);
  const dests = (creators||[]).filter(c => c.email && /@/.test(c.email) && c.status !== 'rechazado');
  if (!dests.length) return 'sin destinatarios';

  let enviados = 0;
  for (const grupo of chunk(dests, 100)){
    const batch = grupo.map(c => ({
      from: FROM,
      reply_to: REPLY_TO,
      to: [c.email.trim()],
      subject: 'Tu semana en la Liga TRAMA. 🔥',
      html: emailSemana(c.nombre, dias),
    }));
    const r = await fetch('https://api.resend.com/emails/batch', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify(batch),
    });
    if (r.ok){ const j = await r.json().catch(()=>({})); enviados += (j.data && j.data.length) || grupo.length; }
  }
  return `${enviados}/${dests.length} mails enviados`;
}

// ───────── CIERRE MENSUAL + CORONACIÓN ─────────
async function cerrarMes(mesNuevo, temporadaVieja){
  // 1) Campeón = mayor índice entre aprobados con puntos
  const top = await sb(`creators?status=eq.aprobado&puntos_mes=gt.0&select=id,nombre,ig_user,puntos_mes,indice&order=indice.desc&limit=1`);
  const campeon = top && top[0];

  // 2) Guardar en el historial
  if (campeon){
    try {
      await sb('liga_historial', 'POST', {
        mes: temporadaVieja,
        creator_id: String(campeon.id),
        nombre: campeon.nombre,
        puntos: campeon.puntos_mes,
      });
    } catch(_){ /* si ya existe ese mes, seguimos */ }
  }

  // 3) Sacar el ×2 del campeón anterior
  try { await sb(`creators?es_campeon=eq.true`, 'PATCH', { es_campeon:false, campeon_label:null }); } catch(_){}

  // 4) Reiniciar puntos e índice de todos (la racha se mantiene)
  try { await sb(`creators?puntos_mes=gt.0`, 'PATCH', { puntos_mes:0, indice:0 }); } catch(_){}
  try { await sb(`creators?indice=gt.0`,     'PATCH', { indice:0 }); } catch(_){}

  // 5) Coronar al nuevo campeón (arranca el mes con ×2)
  if (campeon){
    await sb(`creators?id=eq.${campeon.id}`, 'PATCH', {
      es_campeon: true,
      campeon_label: `Campeón de ${mesNombre(temporadaVieja)}`,
    });
  }

  // 6) Marcar la temporada nueva
  await sb(`config?clave=eq.temporada_actual`, 'PATCH', { valor: mesNuevo });

  return { campeon: campeon ? (campeon.ig_user || campeon.nombre) : null, cerrado: temporadaVieja };
}

// ───────── HANDLER ─────────
export default async function handler(req, res){
  // Auth: Bearer (Vercel Cron) o ?secret= (prueba manual)
  const auth   = req.headers.authorization || '';
  const secret = (req.query && req.query.secret) || '';
  if (!CRON_SECRET) return res.status(500).json({ error: 'Falta CRON_SECRET en el entorno' });
  if (auth !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET){
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { iso, wd } = hoyART();
  const mesActual = iso.slice(0, 7);   // YYYY-MM
  const out = { fecha: iso, dia: wd };

  try {
    // 1) ¿Cambió el mes? → cerrar temporada y coronar
    const cfg = await sb(`config?clave=eq.temporada_actual&select=valor`);
    const temporada = cfg && cfg[0] && cfg[0].valor;
    if (!temporada){
      await sb('config', 'POST', { clave:'temporada_actual', valor: mesActual });
      out.temporada = `inicializada en ${mesActual}`;
    } else if (temporada !== mesActual){
      out.rollover = await cerrarMes(mesActual, temporada);
    } else {
      out.rollover = 'sin cambios (mismo mes)';
    }

    // 2) Mail semanal: solo lunes (o ?force=1 para probar)
    const force = req.query && req.query.force === '1';
    out.email = (wd === 'Mon' || force) ? await enviarMailSemanal(iso) : 'skip (no es lunes)';

    return res.status(200).json({ ok:true, ...out });
  } catch (err){
    console.error('Liga cron error:', err);
    return res.status(500).json({ error: err.message, ...out });
  }
}
