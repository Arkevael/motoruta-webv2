// Lugares agregados a mano (tabla `places` en Postgres): talleres, grifos y miradores.

const db = require('../db');
const { cumulativeDistances, nearestVertex, haversine } = require('../utils/geo');

const KINDS = ['moto', 'auto', 'grifo', 'mirador'];
const COLUMNS = 'id, name, kind, lat, lon, phone, opening_hours, notes, created_at, updated_at';

const toApi = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  lat: r.lat,
  lon: r.lon,
  phone: r.phone,
  openingHours: r.opening_hours,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function listAll() {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM places ORDER BY id DESC LIMIT 1000`);
  return rows.map(toApi);
}

async function create(p) {
  const { rows } = await db.query(
    `INSERT INTO places (name, kind, lat, lon, phone, opening_hours, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
    [p.name, p.kind, p.lat, p.lon, p.phone, p.openingHours, p.notes]
  );
  return toApi(rows[0]);
}

async function update(id, p) {
  const { rows } = await db.query(
    `UPDATE places SET name = $1, kind = $2, lat = $3, lon = $4, phone = $5, opening_hours = $6, notes = $7, updated_at = now()
     WHERE id = $8 RETURNING ${COLUMNS}`,
    [p.name, p.kind, p.lat, p.lon, p.phone, p.openingHours, p.notes, id]
  );
  return rows[0] ? toApi(rows[0]) : null;
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM places WHERE id = $1', [id]);
  return rowCount > 0;
}

/** Lugares manuales cercanos a la ruta, con el mismo formato que los de Overpass. */
async function findNearRoute(geometry) {
  const empty = { workshops: [], viewpoints: [], fuel: [] };
  if (!db.isConfigured()) return empty;

  const coords = geometry.coordinates;
  const radius = Number(process.env.SEARCH_RADIUS_METERS) || 3000;
  const lats = coords.map((c) => c[1]);
  const lons = coords.map((c) => c[0]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = radius / 111000;
  const dLon = radius / (111000 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));

  // Primero un filtro barato por rectángulo en SQL; la distancia exacta a la ruta se calcula aquí
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM places WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4 LIMIT 2000`,
    [Math.min(...lats) - dLat, Math.max(...lats) + dLat, Math.min(...lons) - dLon, Math.max(...lons) + dLon]
  );

  const cum = cumulativeDistances(coords);
  const out = { workshops: [], viewpoints: [], fuel: [] };
  for (const r of rows) {
    const near = nearestVertex(coords, r.lat, r.lon);
    if (near.distance > radius) continue;
    const item = {
      id: `manual/${r.id}`,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lon: r.lon,
      kmFromStart: Math.round(cum[near.index] / 100) / 10,
      offRouteMeters: Math.round(near.distance),
      phone: r.phone,
      openingHours: r.opening_hours,
      notes: r.notes,
      manual: true,
    };
    (r.kind === 'mirador' ? out.viewpoints : r.kind === 'grifo' ? out.fuel : out.workshops).push(item);
  }
  return out;
}

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/** Un lugar de OpenStreetMap es «el mismo» que uno manual si está a <60 m o tiene igual nombre a <500 m. */
function isDuplicate(osm, manual) {
  const d = haversine(osm.lat, osm.lon, manual.lat, manual.lon);
  if (d < 60) return true;
  const a = normalize(osm.name);
  return a.length > 3 && a === normalize(manual.name) && d < 500;
}

/** Combina Overpass + manuales. Si hay duplicado, gana el manual (lo escribió una persona). */
function mergePlaces(osm, manual) {
  const rank = { moto: 0, auto: 1 };
  const merge = (list, extra) => [...list.filter((o) => !extra.some((m) => isDuplicate(o, m))), ...extra];
  const workshops = merge(osm.workshops, manual.workshops).sort((a, b) => (rank[a.kind] ?? 2) - (rank[b.kind] ?? 2) || a.kmFromStart - b.kmFromStart);
  const byKm = (a, b) => a.kmFromStart - b.kmFromStart;
  return {
    workshops: workshops.slice(0, 40),
    viewpoints: merge(osm.viewpoints, manual.viewpoints).sort(byKm).slice(0, 30),
    fuel: merge(osm.fuel, manual.fuel).sort(byKm).slice(0, 80),
  };
}

module.exports = { KINDS, listAll, create, update, remove, findNearRoute, mergePlaces };
