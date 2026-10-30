const test = require('node:test');
const assert = require('node:assert/strict');
const { haversine, cumulativeDistances, indicesByDistance } = require('../server/utils/geo');
const { buildProfile } = require('../server/services/elevation');

test('haversine: 1° de latitud ≈ 111,2 km', () => {
  const d = haversine(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111195) < 300, `distancia ${d}`);
});

test('indicesByDistance reparte por distancia, no por cantidad de vértices', () => {
  // 10 vértices muy juntos y luego un salto largo: por índice se tomaría casi todo del tramo corto
  const coords = [...Array.from({ length: 10 }, (_, i) => [i * 0.001, 0]), [1, 0]];
  const cum = cumulativeDistances(coords);
  const idx = indicesByDistance(cum, 3);
  assert.equal(idx[0], 0);
  assert.equal(idx[2], coords.length - 1);
  assert.equal(idx.length, 3);
});

test('buildProfile: desnivel acumulado, extremos y avisos', () => {
  const pts = [2800, 3200, 4300, 3500, 2900].map((elevation, i) => ({ km: i * 10, lat: 0, lon: 0, elevation }));
  const p = buildProfile(pts);
  assert.equal(p.max.elevation, 4300);
  assert.equal(p.max.km, 20);
  assert.equal(p.min.elevation, 2800);
  assert.ok(p.gain > 0 && p.loss > 0);
  assert.ok(p.alerts[0].includes('soroche'));
});
