// api/liga.js
// Motor de la "Liga TRAMA." — gamificación diaria de creadores.
//
// Qué hace:
//   - action 'estado'  → devuelve la misión del día + puntos/racha/posición del creador.
//   - action 'cumplir' → registra la misión del día como cumplida y recalcula el Índice.
//
// Seguridad:
//   - El navegador manda el access_token del login del creador (Supabase Auth).
//   - Acá verificamos ese token contra /auth/v1/user para saber QUIÉN es,
//     así nadie puede sumar puntos haciéndose pasar por otro.
//   - Las escrituras van con service_role. El 'tipo' de misión se decide en el
//     servidor según la fecha (no se confía en el cliente).
//
// Variables de entorno (ya están en Vercel):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const SB_URL     = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY;

const TZ = 'America/Argentina/Buenos_Aires';

// — Puntaje base por tipo de misión (ajustable sin tocar la base de datos) —
const PUNTOS = { reto: 30, trivia: 10, tendencia: 10 };

// — Agenda semanal: qué tipo de misión toca cada día —
//   (Dom = libre, descanso; Vie = el día grande, reto creativo)
const AGENDA = {
  Mon: 'trivia', Tue: 'tendencia', Wed: 'trivia',
  Thu: 'tendencia', Fri: 'reto', Sat: 'tendencia', Sun: 'libre',
};

// — Textos de fallback hasta que carguemos el pool (Fase 4) —
const FALLBACK = {
  reto:      'Subí un reel o una foto nueva mostrando tu estilo y etiquetá a TRAMA.',
  tendencia: 'Sumate a la tendencia del momento con tu propio toque y publicá.',
  trivia:    'Entrá y respondé la pregunta del día.',
};

// Helper REST con service_role (bypassea RLS)
async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SB_SERVICE,
      'Authorization': `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `Supabase HTTP ${r.status}`);
  }
  return method === 'PATCH' ? null : r.json();
}

// Fecha de hoy en horario de Argentina → { iso: 'YYYY-MM-DD', wd: 'Mon'... }
function hoyART() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const p = f.formatToParts(new Date());
  const g = t => p.find(x => x.type === t)?.value;
  return { iso: `${g('year')}-${g('month')}-${g('day')}`, wd: g('weekday') };
}

// El día anterior a un 'YYYY-MM-DD' (seguro contra zonas horarias)
function ayerDe(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Índice = puntos del mes potenciados por la racha (la racha pesa fuerte)
//   racha 20 ≈ ×2 ; tope en racha 40 (×3) para que no explote
function calcIndice(puntos, racha) {
  const factor = 1 + Math.min(racha, 40) * 0.05;
  return Math.round(puntos * factor * 100) / 100;
}

// Verifica el token del creador y devuelve su email
async function emailDelToken(token) {
  if (!token) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SB_SERVICE, 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.email ? u.email.trim().toLowerCase() : null;
}

// Busca al creador por email (el vínculo auth↔perfil es por email)
async function creatorPorEmail(email) {
  const rows = await sb(`creators?email=ilike.${encodeURIComponent(email)}&select=*`);
  return rows?.[0] || null;
}

// La misión de hoy (tipo + contenido). Rota cada SEMANA (distinta combinación
// por semana, pero estable de lunes a domingo → coincide con el mail semanal).
async function misionDeHoy(wd, iso) {
  const tipo = AGENDA[wd] || 'tendencia';
  if (tipo === 'libre') return { tipo: 'libre', contenido: null, base: 0, requiere_material: false, extra: null };
  let contenido = FALLBACK[tipo];
  let extra = null;
  let requiere_material = (tipo === 'reto');
  try {
    const pool = await sb(`misiones_pool?tipo=eq.${tipo}&activo=eq.true&select=contenido,extra,requiere_material&order=id`);
    if (pool && pool.length) {
      const dayNum = Math.floor(Date.parse(iso) / 86400000);  // días desde epoch
      const week = Math.floor((dayNum + 4) / 7);               // nº de semana (alineado a lunes)
      const wdIdx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd] || 0;
      const pick = pool[(week * 7 + wdIdx) % pool.length];     // semilla semana+día
      contenido = pick.contenido;
      extra = pick.extra || null;
      requiere_material = !!pick.requiere_material;
    }
  } catch (_) { /* pool vacío → usamos el fallback */ }
  return { tipo, contenido, extra, requiere_material, base: PUNTOS[tipo] || 10 };
}

// Posición del creador entre los aprobados (#X de Y)
async function posicion(indiceDelCreador) {
  const total = await sb('creators?status=eq.aprobado&select=id');
  const mejores = await sb(`creators?status=eq.aprobado&indice=gt.${indiceDelCreador}&select=id`);
  return { posicion: (mejores?.length || 0) + 1, total: total?.length || 0 };
}

// Campeón vigente (el del mes, con su ×2)
async function campeonVigente() {
  try {
    const rows = await sb('creators?es_campeon=eq.true&select=nombre,ig_user,campeon_label&limit=1');
    const c = rows?.[0];
    if (!c) return null;
    return { nombre: c.nombre || 'Creador', handle: c.ig_user || null, label: c.campeon_label || null };
  } catch (_) { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { action, token } = req.body || {};

  try {
    const email = await emailDelToken(token);
    if (!email) return res.status(401).json({ error: 'Sesión no válida. Volvé a iniciar sesión.' });

    const creator = await creatorPorEmail(email);
    if (!creator) return res.status(404).json({ error: 'No encontramos tu perfil de creador.' });

    const { iso, wd } = hoyART();
    const mision = await misionDeHoy(wd, iso);

    // ————— ESTADO —————
    if (action === 'estado') {
      const { posicion: pos, total } = await posicion(creator.indice || 0);
      const campeon = await campeonVigente();
      let entregas = [];
      try {
        entregas = await sb(`entregas?creator_id=eq.${encodeURIComponent(String(creator.id))}&select=fecha,tipo,consigna,link&order=created_at.desc&limit=8`);
      } catch (_) { /* sin entregas aún */ }
      return res.status(200).json({
        ok: true,
        data: {
          mision: {
            tipo: mision.tipo,
            contenido: mision.contenido,
            requiere_material: !!mision.requiere_material,
            opciones: (mision.extra && mision.extra.opciones) || null,
          },
          entregas,
          es_libre: mision.tipo === 'libre',
          ya_cumplida: creator.ultima_mision === iso,
          base_hoy: mision.base,
          puntos_mes: creator.puntos_mes || 0,
          racha: creator.racha || 0,
          indice: creator.indice || 0,
          es_campeon: !!creator.es_campeon,
          posicion: pos,
          total,
          campeon,
        },
      });
    }

    // ————— CUMPLIR —————
    if (action === 'cumplir') {
      if (mision.tipo === 'libre') {
        return res.status(200).json({ ok: true, libre: true, msg: 'Hoy es día libre, ¡descansá! 🌙' });
      }
      // Ya cumplió hoy → idempotente, no suma doble
      if (creator.ultima_mision === iso) {
        return res.status(200).json({
          ok: true, ya: true,
          data: { puntos_mes: creator.puntos_mes, racha: creator.racha, indice: creator.indice },
        });
      }

      const { link, respuesta } = req.body || {};

      // Trivia → hay que acertar antes de sumar puntos
      if (mision.tipo === 'trivia' && mision.extra && typeof mision.extra.correcta === 'number') {
        if (Number(respuesta) !== mision.extra.correcta) {
          return res.status(200).json({ ok: false, incorrecta: true, error: 'Respuesta incorrecta, ¡probá de nuevo!' });
        }
      }

      // Reto con material → exigir link válido y guardar la entrega
      if (mision.requiere_material) {
        const url = (link || '').trim();
        if (!/^https?:\/\/.+/i.test(url)) {
          return res.status(200).json({ ok: false, falta_link: true, error: 'Pegá el link de tu publicación para registrar el reto.' });
        }
        try {
          await sb('entregas', 'POST', {
            creator_id: String(creator.id), fecha: iso, tipo: mision.tipo,
            consigna: mision.contenido, link: url,
          });
        } catch (_) { /* la entrega no bloquea el puntaje */ }
      }

      // Racha: si ayer cumplió → +1, si no → vuelve a 1
      const racha = (creator.ultima_mision === ayerDe(iso)) ? (creator.racha || 0) + 1 : 1;
      const mult = creator.es_campeon ? 2 : 1;              // campeón del mes: ×2
      const puntos_mes = (creator.puntos_mes || 0) + mision.base * mult;
      const indice = calcIndice(puntos_mes, racha);

      // IMPORTANTE: solo tocamos columnas del juego, nunca 'status'
      await sb(`creators?id=eq.${creator.id}`, 'PATCH', {
        puntos_mes, racha, indice, ultima_mision: iso,
      });

      const { posicion: pos, total } = await posicion(indice);
      return res.status(200).json({
        ok: true,
        data: {
          sumado: mision.base * mult,
          puntos_mes, racha, indice,
          posicion: pos, total,
        },
      });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });
  } catch (err) {
    console.error('Liga API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
