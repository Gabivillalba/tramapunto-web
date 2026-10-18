// api/admin.js
// Backend del panel admin de TRAMA.
// Toda operación sensible corre acá, con service_role, nunca en el navegador.
//
// Variables de entorno necesarias en Vercel:
//   ADMIN_PASS          → contraseña del panel (elegí una fuerte y larga)
//   SUPABASE_URL        → https://mcpmabvxmdepastmpzbi.supabase.co
//   SUPABASE_SERVICE_KEY→ service_role key (Settings → API → service_role)
//   SITE_URL            → https://www.tramapunto.com (para los emails)
//
// El front manda la contraseña en el header 'x-admin-pass'. Se compara
// en el servidor con una comparación de tiempo constante propia (sin
// depender del módulo 'crypto', para que funcione en cualquier runtime).

const SB_URL      = process.env.SUPABASE_URL;
const SB_SERVICE  = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASS  = process.env.ADMIN_PASS;
const SITE_URL    = process.env.SITE_URL || 'https://www.tramapunto.com';

// Comparación de contraseñas resistente a timing attacks, sin 'crypto'.
function passOk(input) {
  if (!input || !ADMIN_PASS) return false;
  const a = String(input);
  const b = String(ADMIN_PASS);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Helper para pegarle a Supabase con service_role (bypassea RLS)
async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SB_SERVICE,
      'Authorization': `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' || method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `Supabase HTTP ${r.status}`);
  }
  return method === 'PATCH' || method === 'DELETE' ? null : r.json();
}

// Dispara un email vía la función existente de Resend (no rompe si falla)
async function enviarEmail(tipo, to, data) {
  try {
    await fetch(`${SITE_URL}/api/enviar-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, to, data }),
    });
  } catch (_) { /* el email es best-effort, no bloquea la operación */ }
}

// Envoltura de email con el estilo de TRAMA. (para los envíos del panel)
function emailWrap({ kicker, titulo, cuerpoHtml, ctaText, ctaHref }) {
  const cta = ctaText && ctaHref ? `<a href="${ctaHref}" style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:.12em;text-transform:uppercase;border-radius:2px;text-decoration:none;margin-top:8px">${ctaText}</a>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TRAMA.</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px"><tr><td align="center">
    <table width="100%" style="max-width:560px;background:#111;border:1px solid #1a1a1a;border-radius:4px;overflow:hidden">
      <tr><td style="background:#080808;padding:24px 32px;border-bottom:1px solid #1a1a1a">
        <span style="font-size:20px;font-weight:900;letter-spacing:.18em;color:#C8FF1A">TRAMA.</span>
      </td></tr>
      <tr><td style="padding:32px">
        ${kicker ? `<p style="margin:0 0 8px;font-size:13px;color:#C8FF1A;font-weight:700;letter-spacing:.1em;text-transform:uppercase">${kicker}</p>` : ''}
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

// Envío por lotes vía Resend. htmlFn(nombre) → cuerpo del mail por destinatario.
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
      headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(grupo),
    });
    if (r.ok) { const j = await r.json().catch(() => ({})); enviados += (j.data && j.data.length) || grupo.length; }
  }
  return enviados;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // 1) Autenticación
  if (!passOk(req.headers['x-admin-pass'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { action, payload = {} } = req.body || {};

  try {
    switch (action) {

      // — Listar creators (todos, para el panel) —
      case 'list_creators': {
        const data = await sb('creators?select=*&order=created_at.desc');
        return res.status(200).json({ ok: true, data });
      }

      // — Listar campañas (todas, incluidas en_revision) —
      case 'list_campanias': {
        const data = await sb('campanias_con_conteo?select=*&order=created_at.desc');
        return res.status(200).json({ ok: true, data });
      }

      // — Ver postulaciones de una campaña (con datos del creador) —
      case 'list_postulaciones': {
        const { campania_id } = payload;
        if (!campania_id) return res.status(400).json({ error: 'Falta campania_id' });
        const data = await sb(
          `postulaciones?campania_id=eq.${campania_id}&select=*,creators(nombre,apellido,email,tel,ig_user,ig_seg,niches,avatar_url)&order=created_at.desc`
        );
        return res.status(200).json({ ok: true, data });
      }

      // — Listar marcas (+ stats de compra) y separar a los creadores que compran —
      case 'list_marcas': {
        const [marcas, conexiones, creators] = await Promise.all([
          sb('marcas?select=*&order=created_at.desc'),
          sb('conexiones?select=marca_email,estado,monto').catch(() => []),
          sb('creators?select=id,email,nombre,apellido').catch(() => []),
        ]);
        const pagadas = (conexiones || []).filter(c => (c.estado || 'pagado') === 'pagado');
        const comprasPorEmail = {};
        pagadas.forEach(c => {
          const e = String(c.marca_email || '').toLowerCase(); if (!e) return;
          (comprasPorEmail[e] = comprasPorEmail[e] || { n: 0, monto: 0 }).n++;
          comprasPorEmail[e].monto += Number(c.monto || 0);
        });
        const emailsMarca = new Set((marcas || []).map(m => String(m.email || '').toLowerCase()));
        const creatorByEmail = Object.fromEntries((creators || []).map(c => [String(c.email || '').toLowerCase(), c]));
        // Compradores que NO son marcas registradas → creadores (u otros) que compran contactos
        const compradores_no_marca = [];
        Object.keys(comprasPorEmail).forEach(e => {
          if (emailsMarca.has(e)) return;
          const cr = creatorByEmail[e];
          compradores_no_marca.push({ email: e, nombre: cr ? `${cr.nombre || ''} ${cr.apellido || ''}`.trim() : null, esCreador: !!cr, ...comprasPorEmail[e] });
        });
        compradores_no_marca.sort((a, b) => b.n - a.n);
        const data = (marcas || []).map(m => ({ ...m, compras: comprasPorEmail[String(m.email || '').toLowerCase()] || { n: 0, monto: 0 } }));
        return res.status(200).json({ ok: true, data, compradores_no_marca });
      }

      // — Convertir el brief de una marca en una campaña (queda en revisión) —
      case 'campania_desde_marca': {
        const { marca_id } = payload;
        if (!marca_id) return res.status(400).json({ error: 'Falta marca_id' });
        const rows = await sb(`marcas?id=eq.${marca_id}&select=*`);
        const m = rows?.[0];
        if (!m) return res.status(404).json({ error: 'Marca no encontrada' });
        if (!m.brief || !String(m.brief).trim()) return res.status(400).json({ error: 'Esta marca no tiene brief cargado' });
        const marcaName = m.nombre_marca || m.razon_social || `${m.nombre || ''} ${m.apellido || ''}`.trim() || 'Marca';
        const created = await sb('campanias', 'POST', {
          marca_nombre: marcaName,
          marca_email: m.email,
          marca_telefono: m.tel || null,
          titulo: (marcaName + ' busca creadores de contenido').slice(0, 120),
          descripcion: String(m.brief).slice(0, 4000),
          tipo: 'ugc',
          estado: 'en_revision',
          nota_admin: 'Generada desde el brief de registro de la marca.',
        });
        return res.status(200).json({ ok: true, campania: created?.[0] || null });
      }

      // — Export de todas las postulaciones (con creador y título de campaña) —
      case 'export_postulaciones': {
        const posts = await sb('postulaciones?select=*,creators(nombre,apellido,email)&order=created_at.desc');
        const camps = await sb('campanias?select=id,titulo');
        const ct = Object.fromEntries((camps || []).map(c => [String(c.id), c.titulo]));
        const data = (posts || []).map(p => ({ ...p, campania_titulo: ct[String(p.campania_id)] || '' }));
        return res.status(200).json({ ok: true, data });
      }

      // — Cambiar estado de un creator (aprobar/rechazar) + email —
      case 'set_creator_status': {
        const { id, status, nota } = payload;
        if (!id || !status) return res.status(400).json({ error: 'Faltan id/status' });
        const body = { status };
        if (nota !== undefined) body.admin_nota = nota;
        await sb(`creators?id=eq.${id}`, 'PATCH', body);

        // Email al creador
        const rows = await sb(`creators?id=eq.${id}&select=nombre,email`);
        const c = rows?.[0];
        if (c) {
          if (status === 'aprobado') {
            await enviarEmail('creator_aprobado', c.email, { nombre: c.nombre });
            // Notificación in-app de bienvenida
            await sb('notificaciones', 'POST', {
              para_email: c.email, tipo: 'sistema', titulo: '¡Tu perfil fue aprobado! ✅',
              cuerpo: 'Ya estás visible en la bolsa de TRAMA. Completá tu perfil y entrá a la Liga para ganar visibilidad.', link: '/perfil.html',
            }).catch(() => {});
          }
          if (status === 'rechazado') await enviarEmail('creator_rechazado', c.email, { nombre: c.nombre, nota: nota || '' });
        }
        return res.status(200).json({ ok: true });
      }

      // — Cambiar estado de una campaña (activar/cerrar/rechazar) + email —
      case 'set_campania_status': {
        const { id, estado, nota } = payload;
        if (!id || !estado) return res.status(400).json({ error: 'Faltan id/estado' });
        const body = { estado };
        if (nota !== undefined) body.nota_admin = nota;
        await sb(`campanias?id=eq.${id}`, 'PATCH', body);

        // Email a la marca cuando se activa
        if (estado === 'activa') {
          const rows = await sb(`campanias?id=eq.${id}&select=marca_nombre,marca_email,titulo`);
          const m = rows?.[0];
          if (m) await enviarEmail('campania_activa', m.marca_email, {
            nombre: m.marca_nombre, titulo: m.titulo,
          });
        }
        return res.status(200).json({ ok: true });
      }

      // — Avisar a TODOS los creadores aprobados de una campaña nueva —
      case 'notificar_campania': {
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Falta RESEND_API_KEY' });
        const rows = await sb(`campanias?id=eq.${id}&select=titulo,descripcion,tipo`);
        const c = rows?.[0];
        if (!c) return res.status(404).json({ error: 'Campaña no encontrada' });
        const creators = await sb('creators?status=eq.aprobado&select=nombre,email');
        const dests = (creators || [])
          .filter(x => x.email && /@/.test(x.email))
          .map(x => ({ nombre: x.nombre, email: x.email }));
        if (!dests.length) return res.status(200).json({ ok: true, enviados: 0, total: 0 });
        const desc = (c.descripcion || '').trim();
        const htmlFn = (nombre) => emailWrap({
          kicker: 'Nueva campaña 📋',
          titulo: c.titulo,
          cuerpoHtml:
            `<p style="margin:0 0 16px">Hola <strong style="color:#F4F4EF">${escapeHtml(nombre) || 'crack'}</strong>,</p>` +
            `<p style="margin:0 0 16px">Una marca publicó una nueva campaña en TRAMA. y ya podés postularte:</p>` +
            `<p style="margin:0 0 6px;font-size:15px;color:#F4F4EF;font-weight:700">${escapeHtml(c.titulo)}</p>` +
            `<p style="margin:0 0 16px;color:#999;line-height:1.6">${escapeHtml(desc.slice(0, 260))}${desc.length > 260 ? '…' : ''}</p>`,
          ctaText: 'Ver y postularme →',
          ctaHref: `${SITE_URL}/oportunidades.html`,
        });
        const enviados = await enviarBatch(dests, `Nueva campaña en TRAMA.: ${c.titulo}`, htmlFn);
        return res.status(200).json({ ok: true, enviados, total: dests.length });
      }

      // — Guardar nota interna de un creator —
      case 'set_creator_nota': {
        const { id, nota } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`creators?id=eq.${id}`, 'PATCH', { admin_nota: nota || null });
        return res.status(200).json({ ok: true });
      }

      // — Leer la configuración (precios) —
      case 'get_config': {
        const data = await sb('config?select=*&order=clave');
        return res.status(200).json({ ok: true, data });
      }

      // — Limpiar cuentas de Auth sin perfil (huérfanas) —
      case 'limpiar_huerfanas': {
        const [creators, marcas] = await Promise.all([
          sb('creators?select=email').catch(() => []),
          sb('marcas?select=email').catch(() => []),
        ]);
        const conPerfil = new Set([...(creators || []), ...(marcas || [])].map(x => String(x.email || '').toLowerCase()).filter(Boolean));
        const borrados = [];
        let page = 1, revisados = 0;
        while (page <= 30) {
          const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=100`, {
            headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
          });
          if (!r.ok) break;
          const j = await r.json().catch(() => ({}));
          const users = j.users || [];
          if (!users.length) break;
          revisados += users.length;
          for (const u of users) {
            const em = String(u.email || '').toLowerCase();
            if (!em || conPerfil.has(em)) continue;
            const dr = await fetch(`${SB_URL}/auth/v1/admin/users/${u.id}`, {
              method: 'DELETE',
              headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
            });
            if (dr.ok) borrados.push(u.email);
          }
          if (users.length < 100) break;
          page++;
        }
        return res.status(200).json({ ok: true, borrados, revisados });
      }

      // — Guardar un valor de configuración —
      case 'set_config': {
        const { clave, valor } = payload;
        if (!clave || valor === undefined) {
          return res.status(400).json({ error: 'Faltan clave/valor' });
        }
        if (clave.startsWith('precio_')) {
          const n = Number(valor);
          if (!Number.isFinite(n) || n < 0 || n > 10000000) {
            return res.status(400).json({ error: 'Precio inválido' });
          }
        }
        // Upsert manual: PATCH si la clave existe, INSERT si no.
        // (Antes un PATCH sobre una clave inexistente devolvía OK sin
        //  cambiar nada → el precio quedaba "pegado" en el fallback.)
        const existe = await sb(`config?clave=eq.${encodeURIComponent(clave)}&select=clave`);
        if (existe && existe.length) {
          await sb(`config?clave=eq.${encodeURIComponent(clave)}`, 'PATCH', { valor: String(valor) });
        } else {
          await sb('config', 'POST', { clave, valor: String(valor) });
        }
        return res.status(200).json({ ok: true });
      }

      // — Eliminar un creator DEFINITIVAMENTE (fila + cuenta de Auth) —
      case 'delete_creator': {
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        let email = null;
        try {
          const rows = await sb(`creators?id=eq.${id}&select=email`);
          email = rows?.[0]?.email || null;
        } catch (_) { /* seguimos igual */ }
        // Las conexiones (ventas) tienen FK sin cascade: hay que borrarlas antes.
        // El resto (reseñas, vistas, postulaciones, favoritos) cae solo por ON DELETE CASCADE.
        try { await sb(`conexiones?creator_id=eq.${id}`, 'DELETE'); } catch (_) { /* sin ventas */ }
        await sb(`creators?id=eq.${id}`, 'DELETE');
        if (email) {
          try {
            const u = await fetch(
              `${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
              { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } }
            ).then(r => r.ok ? r.json() : null);
            const authId = u?.users?.[0]?.id || u?.[0]?.id || null;
            if (authId) {
              await fetch(`${SB_URL}/auth/v1/admin/users/${authId}`, {
                method: 'DELETE',
                headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
              });
            }
          } catch (_) { /* best-effort */ }
        }
        return res.status(200).json({ ok: true });
      }

      // — Crear cuentas de acceso para creators que no la tienen (backfill) —
      case 'backfill_cuentas': {
        const LOTE = Math.min(Number(payload.limit) || 20, 40);
        const creators = await sb('creators?select=email');
        const emailsCreators = [...new Set(
          (creators || []).map(c => (c.email || '').trim().toLowerCase()).filter(Boolean)
        )];
        const authEmails = new Set();
        let page = 1;
        for (;;) {
          const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
            headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          });
          if (!r.ok) break;
          const j = await r.json();
          const list = j.users || j.data || (Array.isArray(j) ? j : []);
          list.forEach(u => u.email && authEmails.add(u.email.trim().toLowerCase()));
          if (!list.length || list.length < 1000) break;
          page++;
          if (page > 20) break;
        }
        const faltantes = emailsCreators.filter(e => !authEmails.has(e));
        const aProcesar = faltantes.slice(0, LOTE);
        let creadas = 0, mails = 0;
        const errores = [];
        for (const email of aProcesar) {
          try {
            const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, {
              method: 'POST',
              headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, email_confirm: true }),
            });
            if (!cr.ok) { const e = await cr.json().catch(() => ({})); throw new Error(e.msg || e.message || `HTTP ${cr.status}`); }
            creadas++;
            const rec = await fetch(`${SB_URL}/auth/v1/recover`, {
              method: 'POST',
              headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
            });
            if (rec.ok) mails++;
          } catch (e) {
            errores.push({ email, error: e.message });
          }
        }
        return res.status(200).json({
          ok: true,
          total_faltantes: faltantes.length,
          creadas, mails,
          restantes: faltantes.length - aProcesar.length,
          errores,
        });
      }

      // — Definir una contraseña nueva para un creator (desde el admin) —
      case 'set_creator_password': {
        const { email, password } = payload;
        if (!email || !password) return res.status(400).json({ error: 'Faltan email/password' });
        if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        const u = await fetch(
          `${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
          { headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` } }
        ).then(r => r.ok ? r.json() : null);
        const authId = u?.users?.[0]?.id || u?.[0]?.id || null;
        if (!authId) return res.status(404).json({ error: 'Ese creator no tiene cuenta de acceso' });
        const up = await fetch(`${SB_URL}/auth/v1/admin/users/${authId}`, {
          method: 'PUT',
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: String(password) }),
        });
        if (!up.ok) { const e = await up.json().catch(() => ({})); throw new Error(e.msg || e.message || `HTTP ${up.status}`); }
        return res.status(200).json({ ok: true });
      }

      // — Mandarle a un creator el email de reseteo de contraseña —
      case 'send_reset': {
        const { email } = payload;
        if (!email) return res.status(400).json({ error: 'Falta email' });
        const rr = await fetch(`${SB_URL}/auth/v1/recover`, {
          method: 'POST',
          headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!rr.ok) { const e = await rr.json().catch(() => ({})); throw new Error(e.msg || e.message || `HTTP ${rr.status}`); }
        return res.status(200).json({ ok: true });
      }

      // — Recordatorio de portfolio a los creadores que no lo cargaron —
      case 'recordar_portfolio': {
        const RESEND = process.env.RESEND_API_KEY;
        if (!RESEND) return res.status(500).json({ error: 'Falta RESEND_API_KEY' });

        const creators = await sb('creators?select=nombre,email,links,status');
        const faltan = (creators || []).filter(c => {
          const sinLink = !c.links || (Array.isArray(c.links) && c.links.filter(Boolean).length === 0);
          return c.email && /@/.test(c.email) && c.status !== 'rechazado' && sinLink;
        });
        if (!faltan.length) {
          return res.status(200).json({ ok: true, enviados: 0, total: 0, msg: 'Todos ya tienen portfolio cargado' });
        }

        const html = (nombre) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TRAMA.</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px"><tr><td align="center">
    <table width="100%" style="max-width:560px;background:#111;border:1px solid #1a1a1a;border-radius:4px;overflow:hidden">
      <tr><td style="background:#080808;padding:24px 32px;border-bottom:1px solid #1a1a1a">
        <span style="font-size:20px;font-weight:900;letter-spacing:.18em;color:#C8FF1A">TRAMA.</span>
      </td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0 0 8px;font-size:13px;color:#C8FF1A;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Sumá tu portfolio 📎</p>
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;color:#F4F4EF">Mostrá tu trabajo, ${nombre || 'crack'}</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#999;line-height:1.7">
          Las marcas ahora pueden ver una <strong style="color:#F4F4EF">preview de tu portfolio</strong> antes de contactarte.
          Cargá el link a tu mejor contenido en tu perfil y aumentá tus chances de que te elijan.
        </p>
        <a href="${SITE_URL}/perfil.html" style="display:inline-block;background:#C8FF1A;color:#080808;padding:12px 24px;font-weight:900;font-size:13px;letter-spacing:.12em;text-transform:uppercase;border-radius:2px;text-decoration:none">Cargar mi portfolio →</a>
        <p style="margin:24px 0 0;font-size:12px;color:#555;line-height:1.6">Entrá a tu perfil, andá a "Editar" y pegá el link en el campo de Portfolio.</p>
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

        let enviados = 0;
        for (let i = 0; i < faltan.length; i += 100) {
          const grupo = faltan.slice(i, i + 100).map(c => ({
            from: 'TRAMA. <info@tramapunto.com>',
            reply_to: 'info.tramapunto@gmail.com',
            to: [c.email.trim()],
            subject: 'Cargá tu portfolio en TRAMA. 📎',
            html: html(c.nombre),
          }));
          const r = await fetch('https://api.resend.com/emails/batch', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(grupo),
          });
          if (r.ok) { const j = await r.json().catch(() => ({})); enviados += (j.data && j.data.length) || grupo.length; }
        }
        return res.status(200).json({ ok: true, enviados, total: faltan.length });
      }

      // — Eliminar una foto de muestra de un creador (moderación) —
      case 'remove_creator_foto': {
        const { id, url } = payload;
        if (!id || !url) return res.status(400).json({ error: 'Faltan id/url' });
        const rows = await sb(`creators?id=eq.${id}&select=fotos`);
        const actuales = Array.isArray(rows?.[0]?.fotos) ? rows[0].fotos : [];
        const fotos = actuales.filter(f => f !== url);
        await sb(`creators?id=eq.${id}`, 'PATCH', { fotos });
        // Borrar el archivo del Storage (best-effort)
        try {
          const marker = '/storage/v1/object/public/creator-fotos/';
          const i = url.indexOf(marker);
          if (i >= 0) {
            const path = url.slice(i + marker.length);
            await fetch(`${SB_URL}/storage/v1/object/creator-fotos/${path}`, {
              method: 'DELETE',
              headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
            });
          }
        } catch (_) { /* no bloquea */ }
        return res.status(200).json({ ok: true, fotos });
      }

      // — Métricas del negocio para el dashboard —
      case 'metrics': {
        const [conexiones, creators, campanias, marcas, resenas, postulaciones, vistas] = await Promise.all([
          sb('conexiones?select=monto,origen,estado,creator_id,created_at,marca_email').catch(() => []),
          sb('creators?select=id,nombre,status,racha,es_campeon,ig_user').catch(() => []),
          sb('campanias?select=estado').catch(() => []),
          sb('marcas?select=email').catch(() => []),
          sb('resenas?select=rating,oculta,created_at').catch(() => []),
          sb('postulaciones?select=estado').catch(() => []),
          sb('vistas_perfil?select=id').catch(() => []),
        ]);
        const num = v => Number(v || 0);
        const pagadas = (conexiones || []).filter(c => (c.estado || 'pagado') === 'pagado');
        const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
        const esDelMes = c => (c.created_at || '').slice(0, 7) === ym;

        const ingresos = pagadas.reduce((a, c) => a + num(c.monto), 0);
        const delMes = pagadas.filter(esDelMes);
        const origen = {
          bolsa: pagadas.filter(c => c.origen !== 'campania').length,
          campania: pagadas.filter(c => c.origen === 'campania').length,
        };

        const byId = Object.fromEntries((creators || []).map(c => [String(c.id), c.nombre]));
        const porCreador = {};
        pagadas.forEach(c => {
          const k = String(c.creator_id);
          if (!k || k === 'null') return;
          (porCreador[k] = porCreador[k] || { ventas: 0, monto: 0 }).ventas++;
          porCreador[k].monto += num(c.monto);
        });
        const top = Object.entries(porCreador)
          .map(([id, v]) => ({ nombre: byId[id] || '—', ventas: v.ventas, monto: v.monto }))
          .sort((a, b) => b.ventas - a.ventas).slice(0, 5);

        const ultimas = [...pagadas]
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 6)
          .map(c => ({ nombre: byId[String(c.creator_id)] || '—', monto: num(c.monto), origen: c.origen || 'bolsa', fecha: c.created_at }));

        const cr = creators || [];
        const creadores = {
          total: cr.length,
          aprobados: cr.filter(c => c.status === 'aprobado').length,
          pendientes: cr.filter(c => c.status === 'pendiente' || !c.status).length,
          rechazados: cr.filter(c => c.status === 'rechazado').length,
          jugando: cr.filter(c => num(c.racha) > 0).length,
        };
        const champ = cr.find(c => c.es_campeon);
        const cp = campanias || [];

        // Métricas nuevas
        const vistasTotal = (vistas || []).length;
        const conversion = vistasTotal ? Math.round((pagadas.length / vistasTotal) * 100) : 0;
        const ticket = pagadas.length ? Math.round(ingresos / pagadas.length) : 0;
        const compradoras = new Set(pagadas.map(c => String(c.marca_email || '').toLowerCase()).filter(Boolean)).size;
        const resVis = (resenas || []).filter(r => !r.oculta);
        const hace7 = Date.now() - 7 * 86400000;
        const resenasRecientes = resVis.filter(r => r.created_at && new Date(r.created_at).getTime() >= hace7).length;
        const resenasStat = { total: resVis.length, prom: resVis.length ? (resVis.reduce((a, r) => a + num(r.rating), 0) / resVis.length) : 0, recientes: resenasRecientes };
        const marcasStat = { total: (marcas || []).length, compradoras };
        const postStat = { total: (postulaciones || []).length };
        // Ventas por día, últimos 30 (UTC) — el panel permite ver 7/14/30
        const ventasPorDia = [];
        for (let i = 29; i >= 0; i--) ventasPorDia.push({ dia: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), n: 0, monto: 0 });
        const didx = Object.fromEntries(ventasPorDia.map((d, i) => [d.dia, i]));
        pagadas.forEach(c => { const k = (c.created_at || '').slice(0, 10); if (k in didx) { ventasPorDia[didx[k]].n++; ventasPorDia[didx[k]].monto += num(c.monto); } });

        // Fuentes de registro (fetch aparte: si la columna no existe aún, no rompe el resto)
        let fuentes = null;
        try {
          const [cf, mf] = await Promise.all([
            sb('creators?select=fuente'),
            sb('marcas?select=fuente').catch(() => []),
          ]);
          const map = {};
          [...(cf || []), ...(mf || [])].forEach(x => {
            const k = (x.fuente && String(x.fuente).trim()) || 'directo';
            map[k] = (map[k] || 0) + 1;
          });
          fuentes = Object.entries(map).map(([fuente, n]) => ({ fuente, n })).sort((a, b) => b.n - a.n).slice(0, 10);
        } catch (_) { fuentes = null; }  // columna 'fuente' aún no creada

        return res.status(200).json({
          ok: true,
          data: {
            ingresos, ventas: pagadas.length,
            ventasMes: delMes.length, ingresosMes: delMes.reduce((a, c) => a + num(c.monto), 0),
            origen, creadores, top, ultimas, fuentes,
            vistas: vistasTotal, conversion, ticket,
            resenas: resenasStat, marcas: marcasStat, postulaciones: postStat, ventasPorDia,
            campeon: champ ? (champ.ig_user || champ.nombre) : null,
            campanias: { total: cp.length, activas: cp.filter(c => c.estado === 'activa').length, en_revision: cp.filter(c => c.estado === 'en_revision').length },
          },
        });
      }

      // — Exportar conexiones/ventas (filas crudas para armar el CSV en el panel) —
      case 'export_conexiones': {
        const cx = await sb('conexiones?select=*&order=created_at.desc');
        return res.status(200).json({ ok: true, data: cx || [] });
      }

      // — Envío masivo de emails a un segmento —
      case 'envio_masivo': {
        const { asunto, cuerpo, segmento } = payload;
        if (!asunto || !cuerpo) return res.status(400).json({ error: 'Falta asunto o cuerpo' });
        if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Falta RESEND_API_KEY' });

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

        // Limpiar + deduplicar por email
        const seen = new Set();
        dests = dests.filter(d => {
          if (!d.email || !/@/.test(d.email)) return false;
          const e = d.email.trim().toLowerCase();
          if (seen.has(e)) return false;
          seen.add(e); return true;
        });
        if (!dests.length) return res.status(200).json({ ok: true, enviados: 0, total: 0, msg: 'Sin destinatarios' });

        const cuerpoBase = escapeHtml(cuerpo).replace(/\n/g, '<br>');
        const htmlFn = (nombre) => emailWrap({
          titulo: '',
          cuerpoHtml: `<p style="margin:0 0 16px">Hola <strong style="color:#F4F4EF">${escapeHtml(nombre) || 'crack'}</strong>,</p>` +
                      cuerpoBase.replace(/\{nombre\}/g, escapeHtml(nombre) || 'crack'),
          ctaText: 'Ir a TRAMA.', ctaHref: SITE_URL,
        });

        const enviados = await enviarBatch(dests, asunto, htmlFn);
        return res.status(200).json({ ok: true, enviados, total: dests.length });
      }

      case 'list_notif': {
        const data = await sb('notificaciones?para_admin=is.true&select=*&order=created_at.desc&limit=50');
        const noLeidas = (data || []).filter(n => !n.leida).length;
        return res.status(200).json({ ok: true, notif: data || [], noLeidas });
      }

      case 'notif_leidas': {
        await sb('notificaciones?para_admin=is.true&leida=is.false', 'PATCH', { leida: true });
        return res.status(200).json({ ok: true });
      }

      case 'list_resenas': {
        const r = await sb('resenas?select=*&order=created_at.desc');
        const ids = [...new Set((r || []).map(x => x.creator_id).filter(Boolean))];
        let names = {};
        if (ids.length) {
          const cs = await sb(`creators?id=in.(${ids.join(',')})&select=id,nombre,apellido`);
          names = Object.fromEntries((cs || []).map(c => [c.id, `${c.nombre || ''} ${c.apellido || ''}`.trim()]));
        }
        return res.status(200).json({ ok: true, resenas: (r || []).map(x => ({ ...x, creador: names[x.creator_id] || '—' })) });
      }

      case 'moderar_resena': {
        const { id, oculta } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`resenas?id=eq.${id}`, 'PATCH', { oculta: !!oculta });
        return res.status(200).json({ ok: true });
      }

      case 'responder_resena': {
        const { id, respuesta } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`resenas?id=eq.${id}`, 'PATCH', { respuesta: (respuesta || '').trim() || null, respuesta_at: new Date().toISOString() });
        return res.status(200).json({ ok: true });
      }

      case 'delete_resena': {
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`resenas?id=eq.${id}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      case 'programar_envio': {
        const { asunto, cuerpo, segmento, enviar_at } = payload;
        if (!asunto || !cuerpo || !enviar_at) return res.status(400).json({ error: 'Faltan datos (asunto, cuerpo o fecha)' });
        if (new Date(enviar_at).getTime() <= Date.now()) return res.status(400).json({ error: 'La fecha debe ser futura' });
        await sb('emails_programados', 'POST', { asunto, cuerpo, segmento: segmento || 'todos', enviar_at, estado: 'pendiente' });
        return res.status(200).json({ ok: true });
      }

      case 'list_programados': {
        const r = await sb('emails_programados?select=*&order=enviar_at.desc');
        return res.status(200).json({ ok: true, programados: r || [] });
      }

      case 'cancelar_programado': {
        const { id } = payload;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`emails_programados?id=eq.${id}&estado=eq.pendiente`, 'PATCH', { estado: 'cancelado' });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: `Acción desconocida: ${action}` });
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
