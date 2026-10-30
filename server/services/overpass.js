// Overpass API: talleres, grifos (gasolineras) y miradores cerca de la ruta.

const { fetchJson } = require('../utils/http');
const { cumulativeDistances, indicesByDistance, nearestVertex } = require('../utils/geo');

const DEFAULT_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const STEP_METERS = 8000; // un punto de muestreo cada ~8 km: la línea sigue la carretera real
const CHUNK_POINTS = 22; // ~170 km por consulta: consultas pequeñas y rápidas
const CONCURRENCY = 2; // Overpass público solo permite ~2 consultas simultáneas por IP
const cooldown = new Map(); // espejo → instante hasta el que se evita tras un 429/504

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryDelay = () => (process.env.OVERPASS_RETRY_DELAY_MS !== undefined ? Number(process.env.OVERPASS_RETRY_DELAY_MS) : 1500);

function buildQuery(points, radius) {
  // "around" con varias coordenadas se interpreta como una polilínea
  const line = points.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(',');
  const around = `(around:${radius},${line})`;
  // Cada categoría tiene su propio límite para que una no tape a las demás en ciudades grandes
  return `[out:json][timeout:25];
(
  nwr["shop"="motorcycle_repair"]${around};
  nwr["shop"="motorcycle"]${around};
  nwr["shop"="car_repair"]${around};
)->.w;
nwr["tourism"="viewpoint"]${around}->.v;
nwr["amenity"="fuel"]${around}->.f;
.w out center tags 60;
.v out center tags 30;
.f out center tags 200;`;
}

function classify(tags) {
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (tags.amenity === 'fuel') return 'fuel';
  if (tags.shop === 'motorcycle_repair' || tags.shop === 'motorcycle' || tags.shop === 'car_repair') return 'workshop';
  return null;
}


function mirrors() {
  return process.env.OVERPASS_URL ? process.env.OVERPASS_URL.split(',').map((u) => u.trim()).filter(Boolean) : DEFAULT_URLS;
}

/** Prueba cada espejo; si todos están saturados espera un poco y da una segunda vuelta. */
async function queryOverpass(query, deadline) {
  const all = mirrors();
  let lastError;
  for (let round = 0; round < 2; round++) {
    const now = Date.now();
    const ready = all.filter((u) => (cooldown.get(u) || 0) <= now);
    for (const url of ready.length ? ready : all) {
      if (Date.now() > deadline) throw lastError || new Error('Tiempo agotado consultando OpenStreetMap');
      try {
        return await fetchJson(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: '*/*',
            'User-Agent': process.env.NOMINATIM_USER_AGENT || 'MotoRuta-Web/1.0 (proyecto academico)',
          },
          body: `data=${encodeURIComponent(query)}`,
          timeout: 20000,
        });
      } catch (err) {
        lastError = err;
        if ([429, 504].includes(err.upstreamStatus) || err.status === 504) cooldown.set(url, Date.now() + 20000);
      }
    }
    if (round === 0) await sleep(retryDelay());
  }
  throw lastError;
}

/** Puntos de la ruta cada ~STEP_METERS, siempre incluyendo el primero y el último. */
function sampleRoute(coords, cum) {
  const out = [0];
  let next = STEP_METERS;
  for (let i = 1; i < coords.length - 1; i++) {
    if (cum[i] >= next) { out.push(i); next = cum[i] + STEP_METERS; }
  }
  if (coords.length > 1) out.push(coords.length - 1);
  return out;
}

/** Trozos consecutivos de la ruta (con un punto de solape para no dejar huecos). */
function chunkPoints(points) {
  const chunks = [];
  for (let i = 0; i < points.length - 1; i += CHUNK_POINTS - 1) chunks.push(points.slice(i, i + CHUNK_POINTS));
  return chunks.length ? chunks : [points];
}

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await tasks[i]() }; } catch (error) { results[i] = { ok: false, error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function findPlaces(geometry) {
  const coords = geometry.coordinates;
  const radius = Number(process.env.SEARCH_RADIUS_METERS) || 3000;
  const cum = cumulativeDistances(coords);
  const samples = sampleRoute(coords, cum).map((i) => coords[i]);
  const chunks = chunkPoints(samples);
  const deadline = Date.now() + (Number(process.env.OVERPASS_BUDGET_MS) || 45000);

  const results = await runPool(chunks.map((pts) => () => queryOverpass(buildQuery(pts, radius), deadline)), CONCURRENCY);
  const okResults = results.filter((r) => r.ok);
  if (!okResults.length) throw results[0].error;
  const failed = results.length - okResults.length;

  const workshops = [];
  const viewpoints = [];
  const fuel = [];
  const seen = new Set();

  for (const { value: data } of okResults) {
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const type = classify(tags);
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!type || lat === undefined || lon === undefined) continue;

      const near = nearestVertex(coords, lat, lon);
      const isMoto = tags.shop === 'motorcycle_repair' || tags.shop === 'motorcycle';
      const kind = type === 'fuel' ? 'grifo' : type === 'viewpoint' ? 'mirador' : isMoto ? 'moto' : 'auto';
      const defaultName = { grifo: 'Grifo / estación de servicio', mirador: 'Mirador', moto: 'Taller de motos', auto: 'Taller mecánico' }[kind];
      const item = {
        id: `${el.type}/${el.id}`,
        name: tags.name || tags.brand || tags.operator || defaultName,
        kind,
        lat,
        lon,
        kmFromStart: Math.round(cum[near.index] / 100) / 10,
        offRouteMeters: Math.round(near.distance),
        phone: tags.phone || tags['contact:phone'] || null,
        openingHours: tags.opening_hours || null,
      };
      if (seen.has(item.id)) continue; // los trozos se solapan: un mismo lugar puede salir dos veces
      seen.add(item.id);
      const dedupe = `${item.name}|${item.lat.toFixed(4)}|${item.lon.toFixed(4)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      (type === 'viewpoint' ? viewpoints : type === 'fuel' ? fuel : workshops).push(item);
    }
  }

  // Talleres de moto primero; después, por orden de aparición a lo largo del viaje.
  const rank = { moto: 0, auto: 1 };
  workshops.sort((a, b) => rank[a.kind] - rank[b.kind] || a.kmFromStart - b.kmFromStart);
  viewpoints.sort((a, b) => a.kmFromStart - b.kmFromStart);
  fuel.sort((a, b) => a.kmFromStart - b.kmFromStart);

  return {
    workshops: workshops.slice(0, 40),
    viewpoints: viewpoints.slice(0, 30),
    fuel: fuel.slice(0, 250),
    complete: failed === 0,
    failedChunks: failed,
    totalChunks: results.length,
  };
}

module.exports = { findPlaces, sampleRoute, chunkPoints, runPool };
