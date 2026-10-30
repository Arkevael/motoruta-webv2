// Modo demostración (DEMO_MODE=true): respuesta de ejemplo fija, sin llamar a ninguna API.
// Sirve para presentar la app sin internet o para probar el frontend. Los datos NO son reales.

const { weatherInfo, alertsFor } = require('../services/openmeteo');
const { buildProfile } = require('../services/elevation');
const { cumulativeDistances, indicesByDistance, nearestVertex } = require('../utils/geo');

// Puntos aproximados Cusco → Pisac → Calca → Urubamba → Ollantaytambo [lon, lat] y altitudes (m) aproximadas
const WAYPOINTS = [[-71.9675, -13.532], [-71.8476, -13.4219], [-71.96, -13.3225], [-72.1167, -13.305], [-72.264, -13.2587]];
const ELEVATIONS = [3400, 2970, 2930, 2870, 2790];

function interpolate(perSegment = 25) {
  const coords = [];
  const elev = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      coords.push([WAYPOINTS[i][0] + (WAYPOINTS[i + 1][0] - WAYPOINTS[i][0]) * t, WAYPOINTS[i][1] + (WAYPOINTS[i + 1][1] - WAYPOINTS[i][1]) * t]);
      elev.push(ELEVATIONS[i] + (ELEVATIONS[i + 1] - ELEVATIONS[i]) * t);
    }
  }
  coords.push(WAYPOINTS[WAYPOINTS.length - 1]);
  elev.push(ELEVATIONS[ELEVATIONS.length - 1]);
  return { coords, elev };
}

function hourly(day, baseTemp, rainBase) {
  const time = [], temperature = [], rainProbability = [], weatherCode = [], windSpeed = [];
  for (let d = 0; d < 2; d++) {
    for (let h = 0; h < 24; h++) {
      const rain = Math.max(0, Math.min(100, rainBase + (h >= 13 && h <= 18 ? 35 : 0) - (h < 8 ? 15 : 0)));
      time.push(`${day(d)}T${String(h).padStart(2, '0')}:00`);
      temperature.push(Math.round((baseTemp - 4 + 8 * Math.sin(((h - 8) / 24) * 2 * Math.PI)) * 10) / 10);
      rainProbability.push(rain);
      weatherCode.push(rain >= 60 ? 61 : rain >= 30 ? 3 : 1);
      windSpeed.push(8 + (h >= 12 && h <= 17 ? 8 : 0));
    }
  }
  return { time, temperature, rainProbability, weatherCode, windSpeed };
}

function buildDemo() {
  const { coords: coordinates, elev } = interpolate();
  const cum = cumulativeDistances(coordinates);
  const total = cum[cum.length - 1];
  const distance = Math.round(total * 1.15); // las curvas alargan el recorrido real
  const duration = Math.round(distance / 11); // ≈ 40 km/h
  const today = new Date();
  // fecha de Perú (UTC-5): el pronóstico por hora del demo usa la hora local del destino
  const day = (n) => new Date(today.getTime() - 5 * 3600000 + n * 86400000).toISOString().slice(0, 10);

  const mkPlace = (idx, name, kind, extra = {}) => {
    const [lon, lat] = coordinates[idx];
    const p = { id: `demo/${idx}`, name, kind, lat: lat + 0.002, lon: lon + 0.002, phone: null, openingHours: null };
    const near = nearestVertex(coordinates, p.lat, p.lon);
    return { ...p, ...extra, kmFromStart: Math.round(cum[near.index] / 100) / 10, offRouteMeters: Math.round(near.distance) };
  };

  const samples = [[11, 3, 20, 12], [14, 2, 30, 9], [16, 1, 10, 14], [17, 61, 70, 18]];
  const labels = ['Origen', 'Tramo 1', 'Tramo 2', 'Destino'];
  const weather = indicesByDistance(cum, 4).map((i, k) => {
    const [lon, lat] = coordinates[i];
    const [temp, code, rain, wind] = samples[k];
    const info = weatherInfo(code);
    const sun = [0, 1].map((d) => ({ date: day(d), sunrise: `${day(d)}T05:58`, sunset: `${day(d)}T17:47` }));
    const w = {
      label: labels[k], lat, lon, fraction: cum[i] / total, km: Math.round(cum[i] / 100) / 10,
      temperature: temp, windSpeed: wind, precipitation: code === 61 ? 1.2 : 0,
      weatherCode: code, description: info.text, icon: info.icon, rainProbability: rain,
      sunrise: sun[0].sunrise, sunset: sun[0].sunset, utcOffsetSeconds: -18000, sun,
      hourly: hourly(day, temp, rain),
    };
    w.alerts = alertsFor(w);
    return w;
  });

  const profileIdx = indicesByDistance(cum, 24);
  const elevation = buildProfile(
    profileIdx.map((i) => ({ km: Math.round(cum[i] / 100) / 10, lat: coordinates[i][1], lon: coordinates[i][0], elevation: Math.round(elev[i]) }))
  );

  return {
    demo: true,
    origin: { name: 'Cusco, Perú', lat: -13.532, lon: -71.9675 },
    destination: { name: 'Ollantaytambo, Perú', lat: -13.2587, lon: -72.264 },
    geometry: { type: 'LineString', coordinates: coordinates },
    distance,
    duration,
    workshops: [mkPlace(10, 'Taller de ejemplo 1 (demo)', 'moto'), mkPlace(60, 'Taller de ejemplo 2 (demo)', 'auto', { manual: true, notes: 'Ejemplo de un lugar agregado desde el panel /admin.html' })],
    viewpoints: [mkPlace(85, 'Mirador de ejemplo (demo)', 'mirador')],
    fuel: [mkPlace(8, 'Grifo de ejemplo 1 (demo)', 'grifo'), mkPlace(72, 'Grifo de ejemplo 2 (demo)', 'grifo')],
    elevation,
    weather,
    photos: [],
    warnings: [],
    cached: false,
  };
}

module.exports = { buildDemo };
