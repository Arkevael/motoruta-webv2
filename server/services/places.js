// Talleres, grifos y miradores desde OpenStreetMap: Geoapify (si hay clave) con Overpass como respaldo.

const overpass = require('./overpass');
const geoapify = require('./geoapify');
const { haversine } = require('../utils/geo');
const { HttpError } = require('../utils/http');

/** Une dos resultados evitando duplicados (mismo tipo a menos de 80 m). */
function mergeResults(a, b) {
  const near = (x, y) => x.kind === y.kind && haversine(x.lat, x.lon, y.lat, y.lon) < 80;
  const join = (la, lb) => [...la, ...lb.filter((y) => !la.some((x) => near(x, y)))].sort((p, q) => p.kmFromStart - q.kmFromStart);
  const rank = { moto: 0, auto: 1 };
  return {
    workshops: join(a.workshops, b.workshops).sort((p, q) => rank[p.kind] - rank[q.kind] || p.kmFromStart - q.kmFromStart).slice(0, 40),
    viewpoints: join(a.viewpoints, b.viewpoints).slice(0, 30),
    fuel: join(a.fuel, b.fuel).slice(0, 250),
    complete: a.complete || b.complete,
    failedChunks: Math.min(a.failedChunks, b.failedChunks),
    totalChunks: b.totalChunks,
    sources: ['geoapify', 'overpass'],
  };
}

async function findPlaces(geometry) {
  let first = null;
  let geoError = null;
  if (geoapify.isConfigured()) {
    try {
      first = await geoapify.findPlaces(geometry);
      if (first.complete) return { ...first, sources: ['geoapify'] };
    } catch (err) {
      geoError = err;
      console.warn(`Geoapify no disponible (${err.message}); se usa Overpass.`);
    }
  }
  try {
    const second = await overpass.findPlaces(geometry);
    return first ? mergeResults(first, second) : { ...second, sources: ['overpass'] };
  } catch (err) {
    if (first) return { ...first, sources: ['geoapify'] }; // al menos lo parcial de Geoapify
    if (geoError) throw new HttpError(502, `Geoapify: ${geoError.message} · Overpass: ${err.message}`);
    throw err;
  }
}

module.exports = { findPlaces, mergeResults };
