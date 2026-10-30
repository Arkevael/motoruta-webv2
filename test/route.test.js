// Pruebas del backend con las APIs externas simuladas (no gastan cuota). Ejecutar: npm test

process.env.NODE_ENV = 'test';
process.env.NOMINATIM_DELAY_MS = '0';
process.env.PEXELS_API_KEY = 'clave-de-prueba';
process.env.RATE_LIMIT_MAX = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');

const { realFetch, calls, failHosts, json } = require('../testing/mockFetch').install();

const app = require('../server/index');
let server;
let base;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
test.beforeEach(() => { failHosts.clear(); calls.length = 0; });

const get = (path) => realFetch(base + path);

test('CP-01 ruta válida devuelve todas las propiedades', async () => {
  const res = await get('/api/route?from=Cusco&to=Ollantaytambo');
  assert.equal(res.status, 200);
  const b = await res.json();
  for (const k of ['geometry', 'distance', 'duration', 'workshops', 'weather', 'photos']) assert.ok(k in b, `falta ${k}`);
  assert.equal(b.distance, 72000);
  assert.equal(b.weather.length, 4);
  assert.equal(b.workshops[0].kind, 'moto'); // talleres de moto primero
  assert.equal(b.viewpoints[0].name, 'Mirador del Valle');
  assert.equal(b.photos[0].photographer, 'Ana');
  assert.deepEqual(b.warnings, []);
  assert.ok(b.weather[0].alerts.some((a) => a.includes('lluvia'))); // 70 % de lluvia
  assert.equal(b.weather[3].sunset, '2026-10-22T17:47');
  assert.equal(b.weather[3].utcOffsetSeconds, -18000);
});

test('CP-10 grifos: devuelve gasolineras ordenadas por kilómetro, con respaldo de nombre', async () => {
  const b = await (await get('/api/route?from=Cusco&to=Ollantaytambo+Grifos')).json();
  assert.equal(b.fuel.length, 2);
  assert.deepEqual(b.fuel.map((f) => f.name).sort(), ['Grifo Los Andes', 'Primax']);
  assert.ok(b.fuel[0].kmFromStart <= b.fuel[1].kmFromStart);
  assert.equal(b.fuel[0].kind, 'grifo');
  assert.ok(b.workshops.every((w) => w.kind !== 'grifo')); // no se mezclan categorías
});

test('CP-11 elevación: perfil, máximos, desnivel y aviso de altura', async () => {
  const b = await (await get('/api/route?from=Cusco&to=Ollantaytambo+Altura')).json();
  const e = b.elevation;
  assert.ok(e.points.length >= 12 && e.points.length <= 80);
  assert.ok(e.max.elevation >= 4100 && e.max.elevation <= 4200, `máx ${e.max.elevation}`);
  assert.equal(e.start, 3000);
  assert.ok(e.gain > 800 && e.loss > 800, `gain ${e.gain} loss ${e.loss}`);
  assert.ok(e.alerts.some((a) => a.includes('soroche')));
  assert.ok(e.points.every((p, i) => i === 0 || p.km >= e.points[i - 1].km)); // km crecientes
});

test('CP-12 clima: cada punto trae fracción del recorrido, pronóstico por hora y orto/ocaso', async () => {
  const b = await (await get('/api/route?from=Cusco&to=Ollantaytambo+Horas')).json();
  assert.equal(b.weather[0].fraction, 0);
  assert.ok(b.weather[3].fraction > 0.95);
  assert.ok(b.weather.every((w, i) => i === 0 || w.fraction >= b.weather[i - 1].fraction));
  assert.equal(b.weather[1].hourly.time.length, 48);
  assert.equal(b.weather[1].hourly.rainProbability[15], 80);
  assert.equal(b.weather[2].sun.length, 2);
});

test('CE-07 elevación caída → 200 sin perfil y con aviso', async () => {
  const orig = global.fetch;
  global.fetch = async (url, o) => (String(url).includes('/v1/elevation') ? json({ error: true }, 500) : orig(url, o));
  try {
    const b = await (await get('/api/route?from=Cusco&to=Ollantaytambo+SinElevacion')).json();
    assert.equal(b.elevation, null);
    assert.ok(b.warnings.some((w) => w.startsWith('Elevación')));
    assert.ok(b.weather.length > 0);
  } finally {
    global.fetch = orig;
  }
});

test('CP-06 la segunda consulta sale de la caché sin llamar a APIs', async () => {
  await get('/api/route?from=Cusco&to=Ollantaytambo');
  calls.length = 0;
  const b = await (await get('/api/route?from=cusco&to=OLLANTAYTAMBO')).json();
  assert.equal(b.cached, true);
  assert.equal(calls.length, 0);
});

test('CP-08 acepta coordenadas como origen (ubicación del usuario)', async () => {
  const res = await get('/api/route?from=' + encodeURIComponent('-13.51630, -71.97850') + '&to=Ollantaytambo+Coords');
  const b = await res.json();
  assert.equal(res.status, 200);
  assert.equal(b.origin.lat, -13.5163);
  assert.match(b.origin.name, /Cusco/); // nombre obtenido con reverse geocoding
});

test('CP-09 si Nominatim falla, geocodifica con Photon', async () => {
  failHosts.add('nominatim');
  const res = await get('/api/route?from=Pisac+Respaldo&to=Urubamba+Respaldo');
  const b = await res.json();
  assert.equal(res.status, 200);
  assert.ok(calls.some((c) => c.startsWith('photon.komoot.io')));
  assert.equal(b.origin.name, 'Pisac, Cusco, Perú');
});

test('CE-01 parámetros ausentes o inválidos → 400', async () => {
  assert.equal((await get('/api/route?from=Cusco')).status, 400);
  assert.equal((await get('/api/route?from=a&to=b')).status, 400);
  assert.equal((await get('/api/route?from=Cusco&to=<script>')).status, 400);
  assert.equal((await get('/api/route?from=' + encodeURIComponent('200, 300') + '&to=Cusco')).status, 400);
});

test('CE-02 lugar inexistente → 404', async () => {
  const res = await get('/api/route?from=Cusco&to=zzzzzzz');
  assert.equal(res.status, 404);
});

test('CE-03 OSRM caído → 502 sin romper el servidor', async () => {
  failHosts.add('router.project-osrm.org');
  const res = await get('/api/route?from=Cusco&to=Ollantaytambo+Peru');
  assert.equal(res.status, 502);
  assert.equal((await get('/api/health')).status, 200);
});

test('CE-04 Overpass caído → 200 con talleres vacíos y aviso', async () => {
  failHosts.add('overpass');
  const res = await get('/api/route?from=Cusco&to=Ollantaytambo+Valle');
  const b = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(b.workshops, []);
  assert.ok(b.warnings.some((w) => w.startsWith('OpenStreetMap'))); // la fuente que falló
  assert.deepEqual(b.fuel, []);
  assert.ok(b.weather.length > 0); // el resto sigue funcionando
});

test('CE-05 Pexels caído → 200 sin fotos', async () => {
  failHosts.add('api.pexels.com');
  const res = await get('/api/route?from=Cusco&to=Ollantaytambo+Sacsayhuaman');
  const b = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(b.photos, []);
  assert.ok(b.warnings.some((w) => w.startsWith('Fotos')));
});

test('endpoint inexistente → 404 JSON', async () => {
  const res = await get('/api/nada');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

test('health check informa el estado sin exponer claves', async () => {
  const b = await (await get('/api/health')).json();
  assert.equal(b.status, 'ok');
  assert.equal(b.pexelsConfigured, true);
  assert.ok(!JSON.stringify(b).includes('clave-de-prueba'));
});

test('seguridad: CSP y Referrer-Policy compatibles con las teselas de OSM', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('frontend: Leaflet, fuentes e imágenes se sirven localmente (sin CDN)', async () => {
  for (const p of ['/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/app.js', '/style.css', '/admin.html', '/admin.js', '/fonts/barlow-condensed-latin-800-normal.woff2', '/fonts/barlow-latin-400-normal.woff2', '/img/contours.svg']) {
    assert.equal((await get(p)).status, 200, p);
  }
});

test('modo demo devuelve datos de ejemplo sin llamar a ninguna API', async () => {
  process.env.DEMO_MODE = 'true';
  try {
    const res = await get('/api/route?from=Lo+que+sea&to=Otro+lugar');
    const b = await res.json();
    assert.equal(res.status, 200);
    assert.equal(b.demo, true);
    assert.ok(b.geometry.coordinates.length > 50);
    assert.equal(b.weather.length, 4);
    assert.ok(b.fuel.length > 0 && b.elevation.points.length > 10);
    assert.equal(b.weather[0].hourly.time.length, 48);
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.DEMO_MODE;
  }
});
