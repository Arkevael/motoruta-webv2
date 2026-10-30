// Geoapify Places API (datos de OpenStreetMap servidos con clave propia: más estable que Overpass público).
// Plan gratuito: 3.000 créditos/día, sin tarjeta. Cada petición Places cuesta 1 crédito.
// Se activa solo si existe GEOAPIFY_API_KEY; si falla, places.js recurre a Overpass.

const { fetchJson } = require('../utils/http');
const { cumulativeDistances, nearestVertex } = require('../utils/geo');
const { sampleRoute, chunkPoints, runPool } = require('./overpass');

const URL = 'https://api.geoapify.com/v2/places';
const CONCURRENCY = 3; // el plan gratuito admite hasta 5 peticiones por segundo

// Una petición por grupo y por tramo: así un grupo denso (grifos) no tapa a los demás.
const GROUPS = [
  { type: 'fuel', categories: ['service.vehicle.fuel'] },
  { type: 'workshop', categories: ['service.vehicle.repair.motorcycle', 'service.vehicle.repair.car'] },
  { type: 'viewpoint', categories: ['tourism.attraction.viewpoint'] },
];

const isConfigured = () => Boolean(process.env.GEOAPIFY_API_KEY);

function fetchGroup(points, radius, group) {
  return fetchJson(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GEOAPIFY_API_KEY },
    body: JSON.stringify({
      categories: group.categories,
      filter: { type: 'polyline', geometry: { type: 'LineString', coordinates: points }, buffer: radius },
      limit: 500,
    }),
    timeout: 15000,
  });
}

async function findPlaces(geometry) {
  const coords = geometry.coordinates;
  const radius = Math.min(Number(process.env.SEARCH_RADIUS_METERS) || 3000, 100000);
  const cum = cumulativeDistances(coords);
  const samples = sampleRoute(coords, cum).map((i) => coords[i]);
  const chunks = chunkPoints(samples);

  const tasks = [];
  for (const pts of chunks) for (const group of GROUPS) tasks.push(() => fetchGroup(pts, radius, group).then((data) => ({ data, group })));
  const results = await runPool(tasks, CONCURRENCY);
  const okResults = results.filter((r) => r.ok);
  if (!okResults.length) throw results[0].error;

  const workshops = [];
  const viewpoints = [];
  const fuel = [];
  const seen = new Set();

  for (const { value } of okResults) {
    for (const f of value.data.features || []) {
      const p = f.properties || {};
      const lon = p.lon ?? f.geometry?.coordinates?.[0];
      const lat = p.lat ?? f.geometry?.coordinates?.[1];
      if (lat === undefined || lon === undefined) continue;
      const id = `geo/${p.place_id || `${lat},${lon}`}`;
      if (seen.has(id)) continue; // los tramos se solapan
      seen.add(id);

      const type = value.group.type;
      const cats = p.categories || [];
      const raw = p.datasource?.raw || {};
      const kind = type === 'fuel' ? 'grifo' : type === 'viewpoint' ? 'mirador' : cats.some((c) => c.includes('motorcycle')) ? 'moto' : 'auto';
      const defaultName = { grifo: 'Grifo / estación de servicio', mirador: 'Mirador', moto: 'Taller de motos', auto: 'Taller mecánico' }[kind];
      const near = nearestVertex(coords, lat, lon);
      const item = {
        id,
        name: p.name || raw.brand || raw.operator || defaultName,
        kind,
        lat,
        lon,
        kmFromStart: Math.round(cum[near.index] / 100) / 10,
        offRouteMeters: Math.round(near.distance),
        phone: p.contact?.phone || raw.phone || raw['contact:phone'] || null,
        openingHours: p.opening_hours || raw.opening_hours || null,
      };
      (type === 'viewpoint' ? viewpoints : type === 'fuel' ? fuel : workshops).push(item);
    }
  }

  const rank = { moto: 0, auto: 1 };
  workshops.sort((a, b) => rank[a.kind] - rank[b.kind] || a.kmFromStart - b.kmFromStart);
  viewpoints.sort((a, b) => a.kmFromStart - b.kmFromStart);
  fuel.sort((a, b) => a.kmFromStart - b.kmFromStart);

  const failed = results.length - okResults.length;
  return {
    workshops: workshops.slice(0, 40),
    viewpoints: viewpoints.slice(0, 30),
    fuel: fuel.slice(0, 250),
    complete: failed === 0,
    failedChunks: failed,
    totalChunks: results.length,
  };
}

module.exports = { findPlaces, isConfigured };
