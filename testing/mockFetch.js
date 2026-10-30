// APIs externas simuladas para las pruebas (no gastan cuota ni necesitan internet).
const assert = require('node:assert/strict');

function install() {
  const realFetch = global.fetch;
  const calls = [];
  const failHosts = new Set();

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push(u.hostname + u.pathname);
    if ([...failHosts].some((h) => u.hostname.startsWith(h))) return json({ message: 'boom' }, 503);

    if (u.hostname === 'nominatim.openstreetmap.org' && u.pathname === '/reverse') {
      return json({ display_name: 'Plaza de Armas, Cusco, Perú' });
    }
    if (u.hostname === 'nominatim.openstreetmap.org') {
      assert.match(opts.headers['User-Agent'], /MotoRuta/);
      const q = u.searchParams.get('q').toLowerCase();
      if (q.includes('zzzz')) return json([]);
      if (q.includes('cusco')) return json([{ lat: '-13.5320', lon: '-71.9675', display_name: 'Cusco, Perú' }]);
      return json([{ lat: '-13.2587', lon: '-72.2640', display_name: 'Ollantaytambo, Urubamba, Cusco, Perú' }]);
    }
    if (u.hostname === 'photon.komoot.io') {
      return json({ features: [{ geometry: { coordinates: [-72.264, -13.2587] }, properties: { name: 'Pisac', state: 'Cusco', country: 'Perú' } }] });
    }
    if (u.hostname === 'router.project-osrm.org') {
      const coordinates = Array.from({ length: 40 }, (_, i) => [-71.9675 - i * 0.0075, -13.532 + i * 0.007]);
      return json({ code: 'Ok', routes: [{ distance: 72000, duration: 5400, geometry: { type: 'LineString', coordinates } }] });
    }
    if (u.hostname === 'api.geoapify.com') {
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers['x-api-key'], 'clave-geoapify');
      const body = JSON.parse(opts.body);
      assert.ok(body.filter.polyline.coordinates.length >= 2, 'debe enviar la ruta como polilínea');
      const cats = body.categories.join(',');
      const f = (id, lon, lat, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { place_id: id, lon, lat, ...props } });
      if (cats.includes('fuel')) return json({ features: [f('g1', -72.12, -13.38, { name: 'Grifo Geo Uno', categories: ['service.vehicle.fuel'] }), f('g2', -72.0, -13.5, { categories: ['service.vehicle.fuel'], datasource: { raw: { brand: 'Repsol', opening_hours: '24/7' } } })] });
      if (cats.includes('repair')) return json({ features: [f('t1', -72.05, -13.45, { name: 'Moto Taller Geo', categories: ['service.vehicle.repair.motorcycle'] })] });
      return json({ features: [f('m1', -72.15, -13.35, { name: 'Mirador Geo', categories: ['tourism.attraction.viewpoint'] })] });
    }
    if (u.hostname.startsWith('overpass')) {
      return json({
        elements: [
          { type: 'node', id: 1, lat: -13.45, lon: -72.05, tags: { shop: 'motorcycle_repair', name: 'Taller Moto Sur' } },
          { type: 'node', id: 2, lat: -13.4, lon: -72.1, tags: { shop: 'car_repair' } },
          { type: 'node', id: 3, lat: -13.35, lon: -72.15, tags: { tourism: 'viewpoint', name: 'Mirador del Valle' } },
          { type: 'node', id: 4, lat: -13.38, lon: -72.12, tags: { amenity: 'fuel', name: 'Grifo Los Andes', opening_hours: '24/7' } },
          { type: 'node', id: 5, lat: -13.5, lon: -72.0, tags: { amenity: 'fuel', brand: 'Primax' } },
        ],
      });
    }
    if (u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/elevation') {
      const n = u.searchParams.get('latitude').split(',').length;
      // sube hasta 4200 m a mitad de ruta y vuelve a bajar
      return json({ elevation: Array.from({ length: n }, (_, i) => Math.round(3000 + 1200 * Math.sin((i / (n - 1)) * Math.PI))) });
    }
    if (u.hostname === 'api.open-meteo.com') {
      const n = u.searchParams.get('latitude').split(',').length;
      assert.ok(u.searchParams.get('hourly'), 'debe pedir el pronóstico por hora');
      const hours = Array.from({ length: 48 }, (_, i) => `2026-10-${22 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`);
      const one = {
        utc_offset_seconds: -18000,
        current: { temperature_2m: 14.2, wind_speed_10m: 11, precipitation: 0, weather_code: 3 },
        hourly: {
          time: hours,
          temperature_2m: hours.map(() => 12),
          precipitation_probability: hours.map((_, i) => (i % 24 === 15 ? 80 : 10)),
          weather_code: hours.map(() => 3),
          wind_speed_10m: hours.map(() => 9),
        },
        daily: {
          time: ['2026-10-22', '2026-10-23'], temperature_2m_max: [20, 21], temperature_2m_min: [5, 6],
          precipitation_probability_max: [70, 20], sunrise: ['2026-10-22T05:58', '2026-10-23T05:57'], sunset: ['2026-10-22T17:47', '2026-10-23T17:47'],
        },
      };
      return json(Array.from({ length: n }, () => one));
    }
    if (u.hostname === 'api.pexels.com') {
      assert.equal(opts.headers.Authorization, 'clave-de-prueba');
      return json({ photos: [{ id: 9, src: { large: 'https://x/l.jpg', medium: 'https://x/m.jpg' }, photographer: 'Ana', photographer_url: 'https://p/ana', url: 'https://p/9', alt: 'Valle' }] });
    }
    throw new Error(`Host no simulado: ${u.hostname}`);
  };

  return { realFetch, calls, failHosts, json };
}

module.exports = { install };
