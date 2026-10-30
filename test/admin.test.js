// Pruebas del panel de administración y de los lugares manuales.
// Usan pg-mem (Postgres en memoria): no necesitan una base real.

process.env.NODE_ENV = 'test';
process.env.NOMINATIM_DELAY_MS = '0';
process.env.PEXELS_API_KEY = 'clave-de-prueba';
process.env.RATE_LIMIT_MAX = '1000';
process.env.ADMIN_PASSWORD = 'clave-segura-123';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');
const { realFetch, calls } = require('../testing/mockFetch').install();

const db = require('../server/db');
const app = require('../server/index');

let server;
let base;
const KEY = { 'x-admin-key': 'clave-segura-123' };
const JSON_H = { 'Content-Type': 'application/json' };

// pg-mem implementa pocas funciones nativas: se registra char_length, que sí existe en Postgres real
function memoryPool() {
  const mem = newDb();
  mem.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (t) => t.length });
  return new (mem.adapters.createPg().Pool)();
}

test.before(async () => {
  db.__setPoolForTests(memoryPool());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { db.__setPoolForTests(null); server.close(); });
test.beforeEach(() => { calls.length = 0; });

const api = (path, { method = 'GET', headers = KEY, body } = {}) =>
  realFetch(base + path, { method, headers: { ...headers, ...(body ? JSON_H : {}) }, body: body ? JSON.stringify(body) : undefined });
const place = (over = {}) => ({ name: 'Taller de Don Pepe', kind: 'moto', lat: -13.406, lon: -72.1026, phone: '984 123 456', openingHours: 'Lu-Sa 8-18', notes: 'Repara motos lineales', ...over });

test('AD-01 sin clave o con clave incorrecta → 401', async () => {
  assert.equal((await api('/api/admin/places', { headers: {} })).status, 401);
  const bad = await api('/api/admin/places', { headers: { 'x-admin-key': 'otra-clave' } });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'unauthorized');
});

test('AD-02 con la clave correcta entra al panel', async () => {
  const res = await api('/api/admin/status');
  assert.equal(res.status, 200);
});

test('AD-03 validación del formulario → 400', async () => {
  for (const bad of [
    place({ name: 'A' }), place({ kind: 'taller' }), place({ lat: 200 }), place({ lon: 'abc' }),
    place({ notes: 'x'.repeat(301) }), place({ name: 'Con\u0007control' }),
  ]) {
    assert.equal((await api('/api/admin/places', { method: 'POST', body: bad })).status, 400, JSON.stringify(bad).slice(0, 60));
  }
});

test('AD-04 alta, listado, edición y baja', async () => {
  const created = await api('/api/admin/places', { method: 'POST', body: place({ name: "Taller'; DROP TABLE places;--" }) });
  assert.equal(created.status, 201);
  const { id, name } = await created.json();
  assert.equal(name, "Taller'; DROP TABLE places;--"); // se guarda como texto, no se ejecuta

  const list = (await (await api('/api/admin/places')).json()).places;
  assert.ok(list.some((p) => p.id === id));

  const upd = await api(`/api/admin/places/${id}`, { method: 'PUT', body: place({ name: 'Taller renombrado' }) });
  assert.equal(upd.status, 200);
  assert.equal((await upd.json()).name, 'Taller renombrado');

  assert.equal((await api(`/api/admin/places/${id}`, { method: 'PUT', body: place(), headers: { ...KEY } })).status, 200);
  assert.equal((await api(`/api/admin/places/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api(`/api/admin/places/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await api('/api/admin/places/abc', { method: 'DELETE' })).status, 400);
  assert.equal((await api('/api/admin/places/999', { method: 'PUT', body: place() })).status, 404);
});

test('AD-05 JSON roto → 400', async () => {
  const res = await realFetch(`${base}/api/admin/places`, { method: 'POST', headers: { ...KEY, ...JSON_H }, body: '{roto' });
  assert.equal(res.status, 400);
});

test('LM-01 un lugar manual cercano aparece en la ruta, marcado como manual', async () => {
  const { id } = await (await api('/api/admin/places', { method: 'POST', body: place({ name: 'Taller Lugar Manual', notes: 'Pregunta por Don Pepe' }) })).json();
  const b = await (await realFetch(`${base}/api/route?from=Cusco&to=Ollantaytambo+Manual1`)).json();
  const mine = b.workshops.find((w) => w.name === 'Taller Lugar Manual');
  assert.ok(mine, 'el taller manual debe estar en la lista');
  assert.equal(mine.manual, true);
  assert.equal(mine.notes, 'Pregunta por Don Pepe');
  assert.ok(mine.kmFromStart > 0 && mine.offRouteMeters < 500);
  await api(`/api/admin/places/${id}`, { method: 'DELETE' });
});

test('LM-02 un lugar lejos de la ruta no aparece', async () => {
  const { id } = await (await api('/api/admin/places', { method: 'POST', body: place({ name: 'Taller en Lima', lat: -12.04, lon: -77.03 }) })).json();
  const b = await (await realFetch(`${base}/api/route?from=Cusco&to=Ollantaytambo+Manual2`)).json();
  assert.ok(!b.workshops.some((w) => w.name === 'Taller en Lima'));
  await api(`/api/admin/places/${id}`, { method: 'DELETE' });
});

test('LM-03 si coincide con uno de OpenStreetMap, no se duplica y gana el manual', async () => {
  // el mock de Overpass trae «Taller Moto Sur» en (-13.45, -72.05)
  const { id } = await (await api('/api/admin/places', { method: 'POST', body: place({ name: 'Taller Moto Sur', lat: -13.4501, lon: -72.0501, notes: 'Dato corregido' }) })).json();
  const b = await (await realFetch(`${base}/api/route?from=Cusco&to=Ollantaytambo+Manual3`)).json();
  const same = b.workshops.filter((w) => w.name === 'Taller Moto Sur');
  assert.equal(same.length, 1);
  assert.equal(same[0].manual, true);
  await api(`/api/admin/places/${id}`, { method: 'DELETE' });
});

test('LM-04 grifos y miradores manuales van a su lista', async () => {
  const g = await (await api('/api/admin/places', { method: 'POST', body: place({ name: 'Grifo del pueblo', kind: 'grifo', lat: -13.38, lon: -72.12 }) })).json();
  const m = await (await api('/api/admin/places', { method: 'POST', body: place({ name: 'Mirador del Apu', kind: 'mirador', lat: -13.35, lon: -72.15 }) })).json();
  const b = await (await realFetch(`${base}/api/route?from=Cusco&to=Ollantaytambo+Manual4`)).json();
  assert.ok(b.fuel.some((f) => f.name === 'Grifo del pueblo' && f.manual));
  assert.ok(b.viewpoints.some((v) => v.name === 'Mirador del Apu' && v.manual));
  await api(`/api/admin/places/${g.id}`, { method: 'DELETE' });
  await api(`/api/admin/places/${m.id}`, { method: 'DELETE' });
});

test('LM-05 al crear un lugar se vacía la caché y aparece de inmediato', async () => {
  const url = `${base}/api/route?from=Cusco&to=Ollantaytambo+Cache`;
  const first = await (await realFetch(url)).json();
  assert.equal((await (await realFetch(url)).json()).cached, true); // quedó en caché
  const { id } = await (await api('/api/admin/places', { method: 'POST', body: place({ name: 'Taller Nuevo Caché' }) })).json();
  const after = await (await realFetch(url)).json();
  assert.equal(after.cached, false);
  assert.ok(after.workshops.some((w) => w.name === 'Taller Nuevo Caché'));
  assert.ok(!first.workshops.some((w) => w.name === 'Taller Nuevo Caché'));
  await api(`/api/admin/places/${id}`, { method: 'DELETE' });
});

test('LM-06 si la base cae, la ruta sigue funcionando con OpenStreetMap y avisa', async () => {
  db.__setPoolForTests({ query: async () => { throw new Error('conexión rechazada'); }, on() {} });
  try {
    const res = await realFetch(`${base}/api/route?from=Cusco&to=Ollantaytambo+BaseCaida`);
    const b = await res.json();
    assert.equal(res.status, 200);
    assert.ok(b.workshops.some((w) => w.name === 'Taller Moto Sur')); // datos de OSM intactos
    assert.ok(b.warnings.some((w) => w.startsWith('Lugares propios')));
  } finally {
    db.__setPoolForTests(memoryPool());
  }
});

test('AD-06 sin ADMIN_PASSWORD el panel queda deshabilitado (503)', async () => {
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    const res = await api('/api/admin/places');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'service_unavailable');
  } finally {
    process.env.ADMIN_PASSWORD = saved;
  }
});

test('AD-07 la fuerza bruta se frena: tras 10 claves incorrectas → 429', async () => {
  // (las pruebas anteriores ya consumieron algunos intentos fallidos)
  let last;
  for (let i = 0; i < 12; i++) last = await api('/api/admin/places', { headers: { 'x-admin-key': 'adivinando' } });
  assert.equal(last.status, 429);
  // y con la clave correcta también queda bloqueado hasta que pase la ventana: es lo esperado por IP
});
