// OSRM: calcula la ruta en moto/auto entre dos coordenadas.

const { fetchJson, HttpError } = require('../utils/http');

async function getRoute(origin, destination) {
  const base = process.env.OSRM_URL || 'https://router.project-osrm.org';
  const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  let data;
  try {
    data = await fetchJson(url, { timeout: 15000 });
  } catch (err) {
    if (err.upstreamBody && err.upstreamBody.code === 'NoRoute') {
      throw new HttpError(404, 'No existe una ruta terrestre entre el origen y el destino');
    }
    throw err;
  }

  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new HttpError(404, 'No existe una ruta terrestre entre el origen y el destino');
  }
  const r = data.routes[0];
  return { geometry: r.geometry, distance: r.distance, duration: r.duration };
}

module.exports = { getRoute };
