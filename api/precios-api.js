// api/precios.js
// FUENTE ÚNICA DE VERDAD de los precios de TRAMA.
//
// Para cambiar un precio: se cambia la env var en Vercel y se redeploya.
// NO hay que tocar ningún HTML. El front consulta este endpoint.
//
// Env vars (opcionales — si no están, usa los defaults de abajo):
//   PRECIO_BOLSA      → desbloqueo de contacto desde la bolsa
//   PRECIO_CAMPANIA   → desbloqueo de contacto de un postulante
//   PRIMER_GRATIS     → 'true' | 'false' — primer desbloqueo de campaña bonificado

const PRECIOS = {
  bolsa: Number(process.env.PRECIO_BOLSA) || 4900,
  campania: Number(process.env.PRECIO_CAMPANIA) || 25000,
  primer_gratis: (process.env.PRIMER_GRATIS ?? 'true') === 'true',
};

// Formateo consistente para mostrar en el front: "$4.900"
function fmt(n){
  return '$' + Number(n).toLocaleString('es-AR');
}

export default async function handler(req, res) {
  // Cache 5 min en el CDN: los precios no cambian seguido
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  return res.status(200).json({
    bolsa: {
      monto: PRECIOS.bolsa,
      label: fmt(PRECIOS.bolsa) + ' ARS',
    },
    campania: {
      monto: PRECIOS.campania,
      label: fmt(PRECIOS.campania) + ' ARS',
      primer_gratis: PRECIOS.primer_gratis,
    },
    moneda: 'ARS',
  });
}

// Exportado para que crear-preferencia.js use los MISMOS valores
// (así el precio que se cobra nunca puede diferir del que se muestra).
export { PRECIOS };
