// Frontend de MotoRuta Web (JS vanilla). Solo habla con el backend propio (/api/route).
// Todo texto externo se inserta con textContent o se escapa (nunca innerHTML sin escapar) para evitar XSS.

const $ = (id) => document.getElementById(id);

/* ---------- Almacenamiento local (historial, favoritas y preferencias) ---------- */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado / sin permiso */ }
  },
};

/* ---------- Mapa ---------- */
const map = L.map('map').setView([-9.19, -75.01], 5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const layer = L.layerGroup().addTo(map);
let markersById = new Map();
let hoverMarker = null;
let lastData = null;
let currentQuery = null;

/* ---------- Utilidades ---------- */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = (m) => `${(m / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 })} km`;
const fmtM = (m) => `${Math.round(m).toLocaleString('es-PE')} m`;
const fmtTime = (d) => d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const shortName = (full) => full.split(',').slice(0, 2).join(',');
function fmtDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function setStatus(kind, text) {
  const box = $('status');
  if (!kind) { box.hidden = true; return; }
  box.hidden = false;
  box.className = kind;
  box.replaceChildren();
  if (kind === 'loading') box.append(el('span', { class: 'roadbar', 'aria-hidden': 'true' }));
  box.append(text);
}
function pin(emoji, cls = '') {
  return L.divIcon({ className: '', html: `<div class="pin ${cls}">${emoji}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16] });
}

// Misma tabla de códigos WMO que usa el backend (para el pronóstico por hora)
function weatherInfo(code) {
  if (code === 0) return { text: 'Despejado', icon: '☀️' };
  if (code === 1) return { text: 'Mayormente despejado', icon: '🌤️' };
  if (code === 2) return { text: 'Parcialmente nublado', icon: '⛅' };
  if (code === 3) return { text: 'Nublado', icon: '☁️' };
  if (code === 45 || code === 48) return { text: 'Niebla', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { text: 'Llovizna', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { text: 'Lluvia', icon: '🌧️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { text: 'Nieve', icon: '❄️' };
  if (code >= 80 && code <= 82) return { text: 'Chubascos', icon: '🌦️' };
  if (code >= 95) return { text: 'Tormenta', icon: '⛈️' };
  return { text: 'Sin datos', icon: '❔' };
}
function alertsFor(p) {
  const a = [];
  if ((p.rainProbability ?? 0) >= 60 || (p.precipitation ?? 0) > 0.5) a.push('Probabilidad alta de lluvia: calzada resbaladiza');
  if ((p.windSpeed ?? 0) >= 40) a.push('Viento fuerte: cuidado con las ráfagas');
  if (p.temperature !== null && p.temperature !== undefined && p.temperature <= 3) a.push('Riesgo de hielo o frío extremo: abrígate');
  if (p.weatherCode === 45 || p.weatherCode === 48) a.push('Poca visibilidad por niebla');
  if (p.weatherCode >= 95) a.push('Tormenta eléctrica: evita viajar');
  return a;
}

/* ---------- Mapa: dibujo de la ruta y puntos ---------- */
function drawMap(data) {
  layer.clearLayers();
  hoverMarker = null;
  markersById = new Map();
  // la ruta se dibuja como una carretera: borde de asfalto y línea amarilla encima
  L.geoJSON(data.geometry, { style: { color: '#1e2124', weight: 9, opacity: 0.92, lineCap: 'round', lineJoin: 'round' } }).addTo(layer);
  const line = L.geoJSON(data.geometry, { style: { color: '#f5c400', weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round' } }).addTo(layer);

  L.marker([data.origin.lat, data.origin.lon], { icon: pin('🟢') }).bindPopup(`<b>Origen</b><br>${escapeHtml(shortName(data.origin.name))}`).addTo(layer);
  L.marker([data.destination.lat, data.destination.lon], { icon: pin('🏁') }).bindPopup(`<b>Destino</b><br>${escapeHtml(shortName(data.destination.name))}`).addTo(layer);

  const add = (p, emoji, cls) => {
    const m = L.marker([p.lat, p.lon], { icon: pin(emoji, cls) })
      .bindPopup(`<b>${escapeHtml(p.name)}</b><br>Km ${p.kmFromStart} del recorrido${p.manual ? '<br>📌 Agregado manualmente' : ''}${p.notes ? `<br><i>${escapeHtml(p.notes)}</i>` : ''}`)
      .addTo(layer);
    markersById.set(p.id, m);
  };
  data.workshops.forEach((p) => add(p, p.kind === 'moto' ? '🔧' : '🛠️'));
  data.fuel.forEach((p) => add(p, '⛽', 'pin-fuel'));
  data.viewpoints.forEach((p) => add(p, '📷'));

  // Clima en el trayecto (se omiten origen y destino, que ya tienen su marcador)
  data.weather.slice(1, -1).forEach((w) =>
    L.marker([w.lat, w.lon], { icon: pin(w.icon), zIndexOffset: -100 })
      .bindPopup(`<b>${escapeHtml(w.label)}</b><br>Ahora: ${w.temperature ?? '–'} °C · ${escapeHtml(w.description)}`)
      .addTo(layer)
  );

  // Leaflet necesita recalcular el tamaño porque el contenedor estaba oculto
  setTimeout(() => { map.invalidateSize(); map.fitBounds(line.getBounds(), { padding: [30, 30] }); }, 50);
}

/* ---------- Preferencias y salida ---------- */
function readPrefs() {
  return { kml: Number($('kml')?.value) || 30, price: Number($('price')?.value) || 0, range: Number($('range')?.value) || 250 };
}
/** Fecha/hora de salida elegida (hoy o mañana) en la hora del dispositivo. */
function readDeparture() {
  const v = $('depart')?.value;
  if (!v) return null;
  const [h, m] = v.split(':').map(Number);
  const d = new Date();
  if ($('day')?.value === '1') d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}

/* ---------- Resumen del viaje ---------- */
function renderSummary(data) {
  const prefs = store.get('motoruta.prefs', { kml: 30, price: 5.5, range: 250 });
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const day = el('select', { id: 'day', 'aria-label': 'Día de salida' }, el('option', { value: '0', text: 'Hoy' }), el('option', { value: '1', text: 'Mañana' }));
  const departInput = el('input', { id: 'depart', type: 'time', value: hhmm });
  const kmlInput = el('input', { id: 'kml', type: 'number', min: '1', max: '200', step: '0.5', value: String(prefs.kml) });
  const priceInput = el('input', { id: 'price', type: 'number', min: '0', step: '0.05', value: String(prefs.price) });
  const rangeInput = el('input', { id: 'range', type: 'number', min: '30', max: '1000', step: '10', value: String(prefs.range ?? 250) });

  const gmaps = el('a', {
    href: `https://www.google.com/maps/dir/?api=1&origin=${data.origin.lat},${data.origin.lon}&destination=${data.destination.lat},${data.destination.lon}&travelmode=driving`,
    target: '_blank', rel: 'noopener', text: '🗺️ Abrir en Google Maps',
  });
  const gpx = el('button', { type: 'button', text: '⬇️ Descargar GPX' });
  const copy = el('button', { type: 'button', text: '🔗 Copiar enlace' });
  const favBtn = el('button', { type: 'button', id: 'favbtn' });
  gpx.addEventListener('click', () => downloadGpx(data));
  favBtn.addEventListener('click', toggleFavorite);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copy.textContent = '✅ Enlace copiado';
    } catch {
      window.prompt('Copia este enlace:', location.href);
    }
    setTimeout(() => { copy.textContent = '🔗 Copiar enlace'; }, 1800);
  });

  $('summary').replaceChildren(
    el('h2', { text: 'Resumen del viaje' }),
    el('p', { class: 'route-names', text: `${shortName(data.origin.name)} → ${shortName(data.destination.name)}` }),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', { text: fmtKm(data.distance) }), el('span', { text: 'Distancia' })),
      el('div', { class: 'stat' }, el('b', { text: fmtDuration(data.duration) }), el('span', { text: 'Duración estimada' })),
      el('div', { class: 'stat' }, el('b', { text: String(data.workshops.length) }), el('span', { text: 'Talleres cercanos' })),
      el('div', { class: 'stat' }, el('b', { text: String(data.fuel.length) }), el('span', { text: 'Grifos registrados' })),
    ),
    el('div', { class: 'trip' },
      el('h3', { text: '🕒 Salida' }),
      el('div', { class: 'row' }, el('label', {}, 'Día', day), el('label', {}, 'Hora', departInput)),
      el('div', { id: 'eta' }),
      el('h3', { text: '⛽ Combustible (estimado)' }),
      el('div', { class: 'row' },
        el('label', {}, 'Rendimiento (km/L)', kmlInput),
        el('label', {}, 'Precio (S/ por litro)', priceInput),
        el('label', {}, 'Autonomía del tanque (km)', rangeInput),
      ),
      el('div', { id: 'fuel', class: 'fuel' }),
      el('div', { class: 'actions' }, favBtn, gmaps, gpx, copy),
    ),
  );

  [day, departInput, kmlInput, priceInput, rangeInput].forEach((i) => i.addEventListener('input', updateAll));
  updateAll();
}

function updateAll() {
  if (!lastData || !$('depart')) return;
  const p = readPrefs();
  store.set('motoruta.prefs', { kml: p.kml, price: p.price, range: p.range });
  updateEta();
  updateWeather();
  updateFuel();
  updateFavButton();
}

/* ---------- Combustible: costo y tramos sin grifos ---------- */
function fuelAnalysis() {
  const total = lastData.distance / 1000;
  const kms = [0, ...lastData.fuel.map((f) => f.kmFromStart), total].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < kms.length; i++) gaps.push({ from: kms[i - 1], to: kms[i], len: kms[i] - kms[i - 1] });
  return { gaps, max: Math.max(...gaps.map((g) => g.len)) };
}

function updateFuel() {
  const { kml, price, range } = readPrefs();
  const box = $('fuel');
  const liters = lastData.distance / 1000 / kml;
  box.textContent = `≈ ${liters.toFixed(1)} L de combustible${price > 0 ? ` · S/ ${(liters * price).toFixed(2)}` : ''} (solo ida)`;

  const warn = $('fuelwarn');
  if (!warn) return;
  warn.replaceChildren();
  const { gaps, max } = fuelAnalysis();
  const limit = range * 0.8; // 20 % de margen
  const bad = gaps.filter((g) => g.len > limit);

  if (lastData.fuelVerified === false) {
    // No se pudo consultar todo OpenStreetMap: no afirmar que hay (o no hay) tramos sin grifos
    warn.append(el('div', { class: 'note warn', text: `⚠️ No se pudieron consultar todos los grifos de la ruta (el servicio de OpenStreetMap está saturado). ${lastData.fuel.length ? 'Los grifos de abajo son solo una parte; ' : ''}vuelve a calcular la ruta en un minuto antes de confiar en el análisis de combustible.` }));
    return;
  }
  if (!lastData.fuel.length) {
    warn.append(el('div', { class: 'note warn', text: `⚠️ No hay grifos registrados cerca de la ruta (${Math.round(lastData.distance / 1000)} km). Tu autonomía es ${range} km: confirma dónde cargar antes de salir.` }));
  } else if (bad.length) {
    for (const g of bad) {
      warn.append(el('div', { class: 'note warn', text: `⚠️ Entre el km ${Math.round(g.from)} y el km ${Math.round(g.to)} hay ~${Math.round(g.len)} km sin grifos registrados. Tu autonomía es ${range} km (con 20 % de margen: ${Math.round(limit)} km): carga combustible antes de ese tramo.` }));
    }
  } else {
    warn.append(el('div', { class: 'note ok', text: `✅ Con tu autonomía de ${range} km no hay tramos largos sin grifos registrados (el mayor es de ~${Math.round(max)} km, saliendo con el tanque lleno).` }));
  }
  warn.append(el('p', { class: 'hint', text: 'Solo se muestran grifos registrados en OpenStreetMap. En zonas rurales puede haber puntos de venta sin mapear: no dependas de ellos sin confirmar.' }));
}

/* ---------- Hora de llegada y luz del día ---------- */
function updateEta() {
  const box = $('eta');
  box.replaceChildren();
  const dep = readDeparture();
  if (!dep) return;
  const etaMs = dep.getTime() + lastData.duration * 1000;
  box.append(el('div', { class: 'note ok', text: `Llegada estimada: ${fmtTime(new Date(etaMs))} (sin contar paradas; hora de tu dispositivo)` }));

  // Orto/ocaso del destino: Open-Meteo los entrega en hora local del destino + desfase UTC
  const dest = lastData.weather[lastData.weather.length - 1];
  const dayIdx = Number($('day').value) || 0;
  const sun = dest?.sun?.[dayIdx] || (dayIdx === 0 ? { sunrise: dest?.sunrise, sunset: dest?.sunset } : null);
  if (!dest || !sun?.sunset || dest.utcOffsetSeconds === null) return;
  const toUtc = (iso) => Date.parse(`${iso}Z`) - dest.utcOffsetSeconds * 1000;
  const sunset = toUtc(sun.sunset);
  const sunrise = sun.sunrise ? toUtc(sun.sunrise) : null;

  if (etaMs > sunset) {
    const latest = new Date(sunset - lastData.duration * 1000 - 30 * 60000);
    box.append(el('div', { class: 'note warn', text: `🌙 Llegarías de noche (puesta de sol ${fmtTime(new Date(sunset))}). Para llegar con luz y 30 min de margen, sal antes de las ${fmtTime(latest)}` }));
  } else {
    box.append(el('div', { class: 'note ok', text: `🌅 Llegarías con luz de día (puesta de sol ${fmtTime(new Date(sunset))}).` }));
  }
  if (sunrise && dep.getTime() < sunrise) {
    box.append(el('div', { class: 'note warn', text: `⚠️ Saldrías antes del amanecer (${fmtTime(new Date(sunrise))}): hay menos visibilidad y más frío.` }));
  }
}

/* ---------- Clima a la hora en que llegarías a cada tramo ---------- */
function forecastAt(w, instantMs) {
  const h = w.hourly;
  if (!h || !h.time?.length || w.utcOffsetSeconds === null) return null;
  const off = w.utcOffsetSeconds * 1000;
  let best = -1;
  let bestDiff = Infinity;
  h.time.forEach((t, i) => {
    const diff = Math.abs(Date.parse(`${t}Z`) - off - instantMs);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  if (best < 0 || bestDiff > 90 * 60000) return null; // hora fuera del pronóstico disponible (hoy y mañana)
  const code = h.weatherCode[best];
  const info = weatherInfo(code);
  const fc = {
    temperature: h.temperature[best],
    rainProbability: h.rainProbability[best],
    windSpeed: h.windSpeed[best],
    weatherCode: code,
    description: info.text,
    icon: info.icon,
  };
  fc.alerts = alertsFor(fc);
  return fc;
}

function updateWeather() {
  const box = $('weather');
  box.replaceChildren(el('h2', { text: 'Clima en el trayecto' }));
  if (!lastData.weather.length) return box.append(el('p', { class: 'empty', text: 'No se pudo obtener el clima en este momento.' }));

  const dep = readDeparture();
  let missing = false;
  for (const w of lastData.weather) {
    const etaMs = dep ? dep.getTime() + w.fraction * lastData.duration * 1000 : null;
    const fc = etaMs !== null ? forecastAt(w, etaMs) : null;
    if (dep && !fc) missing = true;
    const title = `${w.label} (km ${w.km})` + (etaMs !== null ? ` · llegas ~${fmtTime(new Date(etaMs))}` : '');
    const c = fc || w;
    const row = el('div', { class: 'wx' },
      el('span', { class: 'icon', text: c.icon }),
      el('div', {}, el('b', { text: `${title}: ` }), `${c.temperature ?? '–'} °C · ${c.description}`),
      el('small', { text: `Viento ${c.windSpeed ?? '–'} km/h · Lluvia ${c.rainProbability ?? '–'} %` + (fc ? ` · Ahora: ${w.temperature ?? '–'} °C, ${w.description}` : ' (condiciones actuales)') }),
    );
    for (const a of (fc || w).alerts || []) row.append(el('div', { class: 'alert', text: `⚠️ ${a}` }));
    box.append(row);
  }
  if (missing) box.append(el('p', { class: 'hint', text: 'Para algunas horas no hay pronóstico (solo se dispone de hoy y mañana): se muestran las condiciones actuales.' }));
}

/* ---------- GPX (para cargar la ruta en un GPS o app de navegación) ---------- */
function downloadGpx(data) {
  const x = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const title = `${shortName(data.origin.name)} → ${shortName(data.destination.name)}`;
  const wpts = [...data.workshops, ...data.fuel, ...data.viewpoints]
    .map((p) => `  <wpt lat="${p.lat}" lon="${p.lon}"><name>${x(p.name)}</name><type>${x(p.kind)}</type></wpt>`)
    .join('\n');
  const pts = data.geometry.coordinates.map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"/>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoRuta Web" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${x(title)}</name></metadata>
${wpts}
  <trk><name>${x(title)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = el('a', { href: url, download: 'motoruta-ruta.gpx' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Perfil de elevación ---------- */
function renderElevation(data) {
  const box = $('elevation');
  box.replaceChildren(el('h2', { text: '⛰️ Perfil de elevación' }));
  const e = data.elevation;
  if (!e || !e.points?.length) return box.append(el('p', { class: 'empty', text: 'No se pudo obtener la elevación en este momento.' }));

  box.append(
    el('div', { class: 'elev-stats' },
      el('div', { class: 'stat' }, el('b', { text: fmtM(e.max.elevation) }), el('span', { text: `Altitud máxima (km ${e.max.km})` })),
      el('div', { class: 'stat' }, el('b', { text: fmtM(e.min.elevation) }), el('span', { text: `Altitud mínima (km ${e.min.km})` })),
      el('div', { class: 'stat' }, el('b', { text: `↑ ${fmtM(e.gain)}` }), el('span', { text: 'Subida acumulada (aprox.)' })),
      el('div', { class: 'stat' }, el('b', { text: `↓ ${fmtM(e.loss)}` }), el('span', { text: 'Bajada acumulada (aprox.)' })),
    ),
  );
  if (e.alerts.length) {
    const stack = el('div', { class: 'stack' });
    e.alerts.forEach((a) => stack.append(el('div', { class: 'note warn', text: `⚠️ ${a}` })));
    box.append(stack);
  }

  const W = 720, H = 240, PL = 54, PR = 14, PT = 12, PB = 30; // márgenes del gráfico (no llamarlas L: taparía a Leaflet)
  const pts = e.points;
  const maxKm = pts[pts.length - 1].km || 1;
  let lo = Math.min(...pts.map((p) => p.elevation));
  let hi = Math.max(...pts.map((p) => p.elevation));
  const pad = Math.max(20, (hi - lo) * 0.08);
  lo = Math.floor((lo - pad) / 50) * 50;
  hi = Math.ceil((hi + pad) / 50) * 50;
  const x = (km) => PL + (km / maxKm) * (W - PL - PR);
  const y = (m) => PT + (1 - (m - lo) / (hi - lo)) * (H - PT - PB);

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'elev', role: 'img', 'aria-label': `Perfil de elevación de ${Math.round(maxKm)} km, entre ${fmtM(e.min.elevation)} y ${fmtM(e.max.elevation)}` });
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    chart.append(svg('line', { x1: PL, x2: W - PR, y1: y(v), y2: y(v), class: 'elev-grid' }), svg('text', { x: PL - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'elev-text' }, Math.round(v).toLocaleString('es-PE')));
  }
  for (let i = 0; i <= 5; i++) {
    const km = (maxKm * i) / 5;
    chart.append(svg('text', { x: x(km), y: H - 8, 'text-anchor': 'middle', class: 'elev-text' }, `${Math.round(km)} km`));
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.km).toFixed(1)},${y(p.elevation).toFixed(1)}`).join(' ');
  chart.append(
    svg('path', { d: `${line} L${x(maxKm)},${H - PB} L${x(0)},${H - PB} Z`, class: 'elev-area' }),
    svg('path', { d: line, class: 'elev-line' }),
  );
  // marcas de grifos a lo largo del eje X (se ven los tramos sin grifos)
  data.fuel.forEach((f) => chart.append(svg('rect', { x: x(f.kmFromStart) - 1.5, y: H - PB - 9, width: 3, height: 9, class: 'elev-fuel' })));

  const cursor = svg('line', { y1: PT, y2: H - PB, x1: 0, x2: 0, class: 'elev-cursor', visibility: 'hidden' });
  const dot = svg('circle', { r: 4.5, class: 'elev-dot', visibility: 'hidden' });
  const hit = svg('rect', { x: PL, y: PT, width: W - PL - PR, height: H - PT - PB, class: 'hit' });
  chart.append(cursor, dot, hit);

  const info = el('div', { class: 'elev-info', text: 'Pasa el cursor (o desliza el dedo) por el gráfico para ver la altitud y el punto en el mapa.' });
  const show = (ev) => {
    const r = chart.getBoundingClientRect();
    const km = Math.min(maxKm, Math.max(0, ((((ev.clientX - r.left) / r.width) * W - PL) / (W - PL - PR)) * maxKm));
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.km - km) < Math.abs(best.km - km)) best = p;
    cursor.setAttribute('x1', x(best.km)); cursor.setAttribute('x2', x(best.km));
    dot.setAttribute('cx', x(best.km)); dot.setAttribute('cy', y(best.elevation));
    cursor.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    info.textContent = `Km ${best.km} · ${fmtM(best.elevation)}`;
    if (!hoverMarker) hoverMarker = L.circleMarker([best.lat, best.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(layer);
    else hoverMarker.setLatLng([best.lat, best.lon]);
  };
  const hide = () => {
    cursor.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    if (hoverMarker) { layer.removeLayer(hoverMarker); hoverMarker = null; }
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);

  box.append(chart, info, el('p', { class: 'legend' }, el('i'), 'Marcas azules: grifos registrados en la ruta. Elevaciones aproximadas (modelo digital de terreno de ~90 m).'));
}

/* ---------- Lugares ---------- */
function placeList(items, emptyText) {
  if (!items.length) return el('p', { class: 'empty', text: emptyText });
  const ul = el('ul', { class: 'place-list' });
  for (const p of items) {
    const sub = [`Km ${p.kmFromStart}`, `a ${p.offRouteMeters} m de la ruta`, p.openingHours, p.phone].filter(Boolean).join(' · ');
    const btn = el('button', { type: 'button' }, el('b', { text: p.name }), p.manual ? el('span', { class: 'badge', text: '📌 manual' }) : null, el('small', { text: sub }), p.notes ? el('small', { class: 'note-line', text: p.notes }) : null);
    btn.addEventListener('click', () => {
      const m = markersById.get(p.id);
      if (!m) return;
      map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 13));
      m.openPopup();
      $('map').scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
    ul.append(el('li', {}, btn));
  }
  return ul;
}

function renderPlaces(data) {
  $('places').replaceChildren(
    el('h2', { text: 'Talleres, grifos y miradores en la ruta' }),
    el('div', { id: 'fuelwarn', class: 'stack' }),
    el('div', { class: 'places-cols' },
      el('div', {}, el('h3', { text: '🔧 Talleres mecánicos' }), placeList(data.workshops, 'No se encontraron talleres cerca de la ruta.')),
      el('div', {}, el('h3', { text: '⛽ Grifos' }), placeList(data.fuel, 'No se encontraron grifos registrados cerca de la ruta.')),
      el('div', {}, el('h3', { text: '📷 Miradores' }), placeList(data.viewpoints, 'No se encontraron miradores cerca de la ruta.')),
    ),
  );
}

function renderPhotos(data) {
  const box = $('photos');
  box.replaceChildren(el('h2', { text: `Fotos de ${shortName(data.destination.name)}` }));
  if (!data.photos.length) return box.append(el('p', { class: 'empty', text: 'No hay fotos disponibles.' }));
  const gallery = el('div', { class: 'gallery' });
  for (const p of data.photos) {
    const img = el('img', { src: p.thumb || p.url, alt: p.alt, loading: 'lazy' });
    const credit = el('figcaption', {}, 'Foto de ',
      el('a', { href: p.photographerUrl, target: '_blank', rel: 'noopener', text: p.photographer }),
      ' en ',
      el('a', { href: p.pexelsUrl, target: '_blank', rel: 'noopener', text: 'Pexels' }),
    );
    gallery.append(el('figure', {}, el('a', { href: p.pexelsUrl, target: '_blank', rel: 'noopener' }, img), credit));
  }
  box.append(gallery);
}

function renderNotices(data) {
  const box = $('notices');
  box.replaceChildren();
  if (data.demo) {
    box.append(el('div', { class: 'demo-banner', text: 'Modo demostración: estos son datos de ejemplo (ruta Cusco → Ollantaytambo aproximada), no consultas reales.' }));
  }
  if (data.warnings?.length) {
    const ul = el('ul');
    data.warnings.forEach((w) => ul.append(el('li', { text: w })));
    box.append(el('div', { class: 'warnings' }, 'Algunos datos no estuvieron disponibles:', ul));
  }
}

/* ---------- Favoritas e historial (solo en este navegador) ---------- */
const FAV_KEY = 'motoruta.favorites';
const favorites = () => store.get(FAV_KEY, []);
const sameRoute = (a, b) => a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase();

function toggleFavorite() {
  if (!currentQuery) return;
  const list = favorites();
  const i = list.findIndex((f) => sameRoute(f, currentQuery));
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ from: currentQuery.from, to: currentQuery.to });
  store.set(FAV_KEY, list.slice(0, 20));
  renderFavorites();
  updateFavButton();
}
function updateFavButton() {
  const b = $('favbtn');
  if (!b || !currentQuery) return;
  const saved = favorites().some((f) => sameRoute(f, currentQuery));
  b.textContent = saved ? '⭐ Guardada en favoritas' : '☆ Guardar en favoritas';
  b.setAttribute('aria-pressed', String(saved));
}
function renderFavorites() {
  const box = $('favorites');
  const list = favorites();
  box.replaceChildren();
  box.hidden = list.length === 0;
  if (!list.length) return;
  box.append('Favoritas:');
  for (const f of list) {
    const go = el('button', { type: 'button', text: `⭐ ${shortName(f.from)} → ${shortName(f.to)}` });
    const rm = el('button', { type: 'button', class: 'rm', text: '✕', 'aria-label': `Quitar ${f.from} → ${f.to} de favoritas`, title: 'Quitar' });
    go.addEventListener('click', () => { $('from').value = f.from; $('to').value = f.to; search(f.from, f.to); });
    rm.addEventListener('click', () => {
      store.set(FAV_KEY, favorites().filter((x) => !sameRoute(x, f)));
      renderFavorites();
      updateFavButton();
    });
    box.append(el('span', { class: 'fav' }, go, rm));
  }
}

function renderRecent() {
  const box = $('recent');
  const list = store.get('motoruta.recent', []);
  box.replaceChildren();
  box.hidden = list.length === 0;
  if (!list.length) return;
  box.append('Recientes:');
  for (const [from, to] of list) {
    const chip = el('button', { type: 'button', class: 'chip', text: `${shortName(from)} → ${shortName(to)}` });
    chip.addEventListener('click', () => { $('from').value = from; $('to').value = to; search(from, to); });
    box.append(chip);
  }
  const clear = el('button', { type: 'button', class: 'chip clear', text: 'Borrar' });
  clear.addEventListener('click', () => { store.set('motoruta.recent', []); renderRecent(); });
  box.append(clear);
}
function remember(from, to) {
  const list = store.get('motoruta.recent', []).filter(([f, t]) => !(f === from && t === to));
  list.unshift([from, to]);
  store.set('motoruta.recent', list.slice(0, 5));
  renderRecent();
}

/* ---------- Búsqueda ---------- */
async function search(from, to) {
  from = from.trim();
  to = to.trim();
  const btn = $('go');
  btn.disabled = true;
  document.body.classList.add('driving'); // la línea de eje de la cabecera avanza mientras se calcula
  $('results').hidden = true;
  setStatus('loading', 'Calculando ruta, clima, grifos y elevación… (puede tardar unos segundos)');
  try {
    let res;
    try {
      res = await fetch(`/api/route?${new URLSearchParams({ from, to })}`);
    } catch {
      throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Error ${res.status}`);

    lastData = data;
    currentQuery = { from, to };
    $('results').hidden = false;
    $('intro').hidden = true;
    renderNotices(data);
    renderPlaces(data);
    renderElevation(data);
    renderPhotos(data);
    renderSummary(data); // al final: actualiza clima por hora, ETA, combustible y tramos sin grifos
    drawMap(data);
    setStatus(null);
    history.replaceState(null, '', `?${new URLSearchParams({ from, to })}`);
    if (!data.demo) remember(from, to);
  } catch (err) {
    setStatus('error', err.message || 'No se pudo completar la búsqueda.');
  } finally {
    btn.disabled = false;
    document.body.classList.remove('driving');
  }
}

/* ---------- Eventos ---------- */
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  search($('from').value, $('to').value);
});
$('swap').addEventListener('click', () => {
  [$('from').value, $('to').value] = [$('to').value, $('from').value];
});
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('error', 'Tu navegador no permite obtener la ubicación.');
  setStatus('loading', 'Obteniendo tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('from').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      setStatus(null);
      $('to').focus();
    },
    () => setStatus('error', 'No se pudo obtener tu ubicación. Revisa el permiso del navegador o escribe el origen a mano.'),
    { enableHighAccuracy: false, timeout: 10000 }
  );
});
document.querySelectorAll('.chip[data-from]').forEach((chip) =>
  chip.addEventListener('click', () => {
    $('from').value = chip.dataset.from;
    $('to').value = chip.dataset.to;
    search(chip.dataset.from, chip.dataset.to);
  })
);

renderFavorites();
renderRecent();
// Enlaces compartibles: /?from=Cusco&to=Ollantaytambo hace la búsqueda al abrir
const params = new URLSearchParams(location.search);
if (params.get('from') && params.get('to')) {
  $('from').value = params.get('from');
  $('to').value = params.get('to');
  search(params.get('from'), params.get('to'));
}
