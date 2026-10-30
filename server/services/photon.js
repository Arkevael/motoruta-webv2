// Photon (Komoot, datos de OpenStreetMap): geocodificador de respaldo, sin key.
// Se usa solo si Nominatim falla (por ejemplo, si bloquea la IP del hosting).

const { fetchJson, HttpError } = require('../utils/http');

const BASE = 'https://photon.komoot.io/api/';

async function geocodePhoton(text) {
  const url = `${BASE}?${new URLSearchParams({ q: text, limit: '1', lang: 'es' })}`;
  const data = await fetchJson(url, {
    headers: { 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'MotoRutaWeb/1.0 (proyecto academico)' },
  });
  const f = data.features?.[0];
  if (!f) throw new HttpError(404, `No se encontró el lugar «${text}»`);
  const p = f.properties || {};
  const name = [...new Set([p.name, p.city || p.county, p.state, p.country].filter(Boolean))].join(', ');
  const [lon, lat] = f.geometry.coordinates;
  return { name: name || text, lat, lon };
}

module.exports = { geocodePhoton };
