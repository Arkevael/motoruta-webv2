// Geocodificación: Nominatim (OpenStreetMap) con Photon como respaldo.
// Política de Nominatim: máx. 1 petición/segundo y User-Agent identificable.
// También acepta coordenadas directas ("-13.532, -71.967") y las convierte a un nombre (reverse).

const { fetchJson, HttpError } = require('../utils/http');
const { TTLCache } = require('../utils/cache');
const { geocodePhoton } = require('./photon');

const BASE = 'https://nominatim.openstreetmap.org';
const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const cache = new TTLCache(60 * 60 * 1000, 500); // 1 hora
let queue = Promise.resolve();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = () => ({ 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'MotoRutaWeb/1.0 (proyecto academico)' });

/** Serializa las llamadas y deja ≥1,1 s entre una y otra. */
function throttled(task) {
  const delay = process.env.NOMINATIM_DELAY_MS !== undefined ? Number(process.env.NOMINATIM_DELAY_MS) : 1100;
  const run = queue.then(task);
  queue = run.catch(() => {}).then(() => sleep(delay));
  return run;
}

async function reverse(lat, lon) {
  const key = `rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const fallback = { name: `Ubicación (${lat.toFixed(4)}, ${lon.toFixed(4)})`, lat, lon };
  try {
    const url = `${BASE}/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'json', zoom: '14', 'accept-language': 'es' })}`;
    const data = await throttled(() => fetchJson(url, { headers: headers() }));
    const place = { name: data.display_name || fallback.name, lat, lon };
    cache.set(key, place);
    return place;
  } catch {
    return fallback; // el nombre es solo informativo; no bloquea la ruta
  }
}

async function geocode(text) {
  const m = COORDS.exec(text);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'Coordenadas fuera de rango');
    return reverse(lat, lon);
  }

  const key = text.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let place;
  try {
    const url = `${BASE}/search?${new URLSearchParams({ q: text, format: 'json', limit: '1', 'accept-language': 'es' })}`;
    const data = await throttled(() => fetchJson(url, { headers: headers() }));
    if (!Array.isArray(data) || data.length === 0) throw new HttpError(404, `No se encontró el lugar «${text}»`);
    place = { name: data[0].display_name, lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch (err) {
    if (err.status === 404) throw err;
    // Nominatim caído o bloqueado (403/429/5xx/timeout): se intenta con Photon
    place = await geocodePhoton(text);
  }
  cache.set(key, place);
  return place;
}

module.exports = { geocode };
