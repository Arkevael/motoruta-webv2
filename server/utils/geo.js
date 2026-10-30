// Funciones geográficas auxiliares (sin dependencias).

const R = 6371000; // radio de la Tierra en metros
const rad = (d) => (d * Math.PI) / 180;

/** Distancia en metros entre dos puntos (fórmula de Haversine). */
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Distancia acumulada (m) en cada vértice de una línea GeoJSON [[lon,lat],...]. */
function cumulativeDistances(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    out.push(out[i - 1] + haversine(lat1, lon1, lat2, lon2));
  }
  return out;
}

/** Devuelve hasta `n` puntos repartidos uniformemente, incluyendo el primero y el último. */
function samplePoints(coords, n) {
  if (coords.length <= n) return coords.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(coords[Math.round((i * (coords.length - 1)) / (n - 1))]);
  return out;
}

/** Índices de `n` vértices repartidos uniformemente por DISTANCIA (incluye primero y último). */
function indicesByDistance(cum, n) {
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = n === 1 ? 0 : (total * i) / (n - 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    out.push(j);
  }
  return out;
}

/** Índice del vértice de la ruta más cercano a (lat, lon) y la distancia a él en metros. */
function nearestVertex(coords, lat, lon) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(lat, lon, coords[i][1], coords[i][0]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distance: bestD };
}

module.exports = { haversine, cumulativeDistances, samplePoints, indicesByDistance, nearestVertex };
