// api/precios.js  (v2)
// Fuente única de verdad de los precios de TRAMA.
// Ahora los lee de la tabla `config` de Supabase → editables desde el admin.
// Si la base falla, cae a las env vars, y si no hay, a los defaults.

const FALLBACK = {
  precio_bolsa:    Number(process.env.PRECIO_BOLSA)    || 4900,
  precio_campania: Number(process.env.PRECIO_CAMPANIA) || 25000,
  precio_labs:     Number(process.env.PRECIO_LABS)     || 30000,
  primer_gratis:   (process.env.PRIMER_GRATIS ?? 'true') === 'true',
};

// Lee la config desde Supabase. Exportada para que la usen
// crear-preferencia.js y cualquier otro endpoint: así el precio
// que se cobra SIEMPRE es el mismo que el que se muestra.
export async function getPrecios() {
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/config?select=clave,valor`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!r.ok) throw new Error('config no disponible');
    const rows = await r.json();
    const map = Object.fromEntries(rows.map(x => [x.clave, x.valor]));

    return {
      precio_bolsa:    Number(map.precio_bolsa)    || FALLBACK.precio_bolsa,
      precio_campania: Number(map.precio_campania) || FALLBACK.precio_campania,
      precio_labs:     Number(map.precio_labs)     || FALLBACK.precio_labs,
      primer_gratis:   map.primer_gratis !== undefined
                         ? map.primer_gratis === 'true'
                         : FALLBACK.primer_gratis,
    };
  } catch (_) {
    return FALLBACK;   // la plataforma nunca se cae por esto
  }
}

function fmt(n){ return '$' + Number(n).toLocaleString('es-AR'); }

// Imágenes de la landing, editables desde el admin (clave `landing_media` en config).
// Devuelve el objeto parseado o null. La landing cae a placeholders si es null.
async function getLandingMedia() {
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/config?clave=eq.landing_media&select=valor`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows || !rows[0] || !rows[0].valor) return null;
    return JSON.parse(rows[0].valor);
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  // Cache corto: si cambiás un precio o una imagen en el admin, se refleja en ~30s
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  const [p, landing] = await Promise.all([getPrecios(), getLandingMedia()]);

  return res.status(200).json({
    bolsa: {
      monto: p.precio_bolsa,
      label: fmt(p.precio_bolsa) + ' ARS',
    },
    campania: {
      monto: p.precio_campania,
      label: fmt(p.precio_campania) + ' ARS',
      primer_gratis: p.primer_gratis,
    },
    labs: {
      monto: p.precio_labs,
      label: fmt(p.precio_labs) + ' ARS',
    },
    moneda: 'ARS',
    landing: landing || null,
  });
}
