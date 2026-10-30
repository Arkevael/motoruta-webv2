// GET /api/route?from=...&to=...
// Compone Nominatim + OSRM y, en paralelo, Overpass + Open-Meteo + Pexels.

const express = require('express');
const { HttpError } = require('../utils/http');
const { TTLCache } = require('../utils/cache');
const { cumulativeDistances, indicesByDistance } = require('../utils/geo');
const { geocode } = require('../services/nominatim');
const { getRoute } = require('../services/osrm');
const { findPlaces } = require('../services/overpass');
const { getWeather } = require('../services/openmeteo');
const { getPhotos } = require('../services/pexels');
const { getElevationProfile } = require('../services/elevation');
const { buildDemo } = require('../demo/sample');
const manual = require('../services/manualPlaces');

const router = express.Router();
const cache = new TTLCache((Number(process.env.CACHE_TTL_SECONDS) || 300) * 1000);

function readPlace(value, field) {
  if (typeof value !== 'string') throw new HttpError(400, `El parámetro «${field}» es obligatorio`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 120) {
    throw new HttpError(400, `«${field}» debe tener entre 2 y 120 caracteres`);
  }
  if (/[\u0000-\u001f<>]/.test(text)) throw new HttpError(400, `«${field}» contiene caracteres no válidos`);
  return text;
}

function weatherPoints(geometry) {
  const coords = geometry.coordinates;
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1] || 1;
  const labels = ['Origen', 'Tramo 1', 'Tramo 2', 'Destino'];
  // fraction = proporción del recorrido en que se encuentra el punto (sirve para estimar la hora de llegada)
  return indicesByDistance(cum, 4).map((i, k) => ({
    label: labels[k],
    lat: coords[i][1],
    lon: coords[i][0],
    fraction: cum[i] / total,
    km: Math.round(cum[i] / 100) / 10,
  }));
}

function photoQuery(place) {
  const parts = place.name.split(',').map((s) => s.trim());
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

/** Overpass (OpenStreetMap) + lugares agregados a mano. Si una de las dos fuentes falla, se usa la otra. */
async function loadPlaces(geometry) {
  const [osm, own] = await Promise.allSettled([findPlaces(geometry), manual.findNearRoute(geometry)]);
  if (osm.status === 'rejected' && own.status === 'rejected') throw osm.reason;
  const empty = { workshops: [], viewpoints: [], fuel: [] };
  const warnings = [];
  if (osm.status === 'rejected') warnings.push(`OpenStreetMap: ${osm.reason?.message || 'no disponible'}. Reintenta en un minuto.`);
  else if (!osm.value.complete) warnings.push(`OpenStreetMap saturado: solo se consultaron ${osm.value.totalChunks - osm.value.failedChunks} de ${osm.value.totalChunks} tramos de la ruta. Reintenta en un minuto para ver todos los grifos.`);
  if (own.status === 'rejected') warnings.push(`Lugares propios: ${own.reason?.message || 'no disponibles'}`);
  const fuelVerified = osm.status === 'fulfilled' && osm.value.complete;
  return { ...manual.mergePlaces(osm.value || empty, own.value || empty), warnings, fuelVerified };
}

router.get('/', async (req, res, next) => {
  try {
    const from = readPlace(req.query.from, 'from');
    const to = readPlace(req.query.to, 'to');

    if (process.env.DEMO_MODE === 'true') return res.json(buildDemo());

    const cacheKey = `${from.toLowerCase()}|${to.toLowerCase()}`;
    const hit = cache.get(cacheKey);
    if (hit) return res.json({ ...hit, cached: true });

    // 1) Geocodificación (Nominatim las serializa por su límite de 1 req/s)
    const [origin, destination] = await Promise.all([geocode(from), geocode(to)]);

    // 2) Ruta (si falla, no hay respuesta útil → error)
    const route = await getRoute(origin, destination);

    // 3) Datos complementarios en paralelo; si alguno falla, se degrada con aviso
    const [places, weather, photos, elevation] = await Promise.allSettled([
      loadPlaces(route.geometry),
      getWeather(weatherPoints(route.geometry)),
      getPhotos(photoQuery(destination)),
      getElevationProfile(route.geometry),
    ]);

    const warnings = [];
    const unwrap = (r, fallback, label) => {
      if (r.status === 'fulfilled') return r.value;
      warnings.push(`${label}: ${r.reason?.message || 'no disponible'}`);
      return fallback;
    };

    const placesData = unwrap(places, { workshops: [], viewpoints: [], fuel: [], warnings: [], fuelVerified: false }, 'Talleres, grifos y miradores');
    warnings.push(...(placesData.warnings || []));
    const body = {
      origin,
      destination,
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      workshops: placesData.workshops,
      viewpoints: placesData.viewpoints,
      fuel: placesData.fuel,
      fuelVerified: placesData.fuelVerified !== false,
      elevation: unwrap(elevation, null, 'Elevación'),
      weather: unwrap(weather, [], 'Clima'),
      photos: unwrap(photos, [], 'Fotos'),
      warnings,
      cached: false,
    };

    // Solo se cachean respuestas completas, para reintentar lo que falló
    if (warnings.length === 0) cache.set(cacheKey, body);
    res.json(body);
  } catch (err) {
    next(err);
  }
});

router.clearCache = () => cache.clear();
module.exports = router;
