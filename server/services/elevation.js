// Perfil de elevación con la API de elevación de Open-Meteo (gratuita, sin key).
// Admite hasta 100 coordenadas por petición.

const { fetchJson, HttpError } = require('../utils/http');
const { cumulativeDistances, indicesByDistance } = require('../utils/geo');

const BASE = 'https://api.open-meteo.com/v1/elevation';
const r1 = (n) => Math.round(n * 10) / 10;

/** points: [{ km, lat, lon, elevation }] → estadísticas y avisos */
function buildProfile(points) {
  const el = points.map((p) => p.elevation);
  // media móvil de 3 puntos para que el ruido del modelo digital no infle subidas y bajadas
  const smooth = el.map((_, i) => {
    const a = el.slice(Math.max(0, i - 1), i + 2);
    return a.reduce((x, y) => x + y, 0) / a.length;
  });
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < smooth.length; i++) {
    const d = smooth[i] - smooth[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  const max = points.reduce((a, b) => (b.elevation > a.elevation ? b : a));
  const min = points.reduce((a, b) => (b.elevation < a.elevation ? b : a));

  const alerts = [];
  if (max.elevation >= 4000) {
    alerts.push(`Altitud máxima de ${max.elevation} m (km ${max.km}): riesgo de soroche, frío intenso y pérdida de potencia del motor. Hidrátate, evita esfuerzos y lleva abrigo.`);
  } else if (max.elevation >= 3000) {
    alerts.push(`El recorrido supera los 3000 m (máx. ${max.elevation} m en el km ${max.km}): puede hacer mucho frío y algunas personas sienten soroche.`);
  }
  if (loss >= 1500) alerts.push(`Descenso acumulado de ${Math.round(loss)} m: usa freno motor para no sobrecalentar los frenos.`);

  return {
    points,
    max: { elevation: max.elevation, km: max.km },
    min: { elevation: min.elevation, km: min.km },
    start: points[0].elevation,
    end: points[points.length - 1].elevation,
    gain: Math.round(gain),
    loss: Math.round(loss),
    alerts,
  };
}

async function getElevationProfile(geometry) {
  const coords = geometry.coordinates;
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  const n = Math.min(80, Math.max(12, Math.round(total / 4000) + 1)); // ≈ 1 punto cada 4 km
  const idx = indicesByDistance(cum, n);

  const params = new URLSearchParams({
    latitude: idx.map((i) => coords[i][1].toFixed(4)).join(','),
    longitude: idx.map((i) => coords[i][0].toFixed(4)).join(','),
  });
  const data = await fetchJson(`${BASE}?${params}`);
  if (!Array.isArray(data.elevation) || data.elevation.length !== idx.length) {
    throw new HttpError(502, 'Respuesta inesperada de la API de elevación');
  }
  const points = idx.map((i, k) => ({
    km: r1(cum[i] / 1000),
    lat: coords[i][1],
    lon: coords[i][0],
    elevation: Math.round(data.elevation[k]),
  }));
  return buildProfile(points);
}

module.exports = { getElevationProfile, buildProfile };
