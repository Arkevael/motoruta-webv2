// Panel de administración de lugares propios. Todo texto se inserta con textContent o se escapa.

const $ = (id) => document.getElementById(id);
const KEY = 'motoruta.adminKey';
const KINDS = { moto: ['🔧', 'Taller de motos'], auto: ['🛠️', 'Taller mecánico'], grifo: ['⛽', 'Grifo'], mirador: ['📷', 'Mirador'] };

let adminKey = '';
try { adminKey = sessionStorage.getItem(KEY) || ''; } catch { /* sin sessionStorage */ }
let places = [];
let editingId = null;
let pending = null; // marcador arrastrable de la ubicación elegida

const map = L.map('amap').setView([-13.53, -71.97], 8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const layer = L.layerGroup().addTo(map);

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c) n.append(c);
  return n;
}
function say(kind, text) {
  const box = $('msg');
  box.hidden = !kind;
  if (!kind) return;
  box.className = kind;
  box.textContent = text;
}
const pin = (emoji) => L.divIcon({ className: '', html: `<div class="pin">${emoji}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16] });

/* ---------- API ---------- */
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      headers: { 'x-admin-key': adminKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) logout(false);
    throw new Error(data.message || `Error ${res.status}`);
  }
  return data;
}

/* ---------- Sesión ---------- */
function showPanel(on) {
  $('login').hidden = on;
  $('panel').hidden = !on;
  if (on) setTimeout(() => map.invalidateSize(), 50);
}
function logout(clearMessage = true) {
  adminKey = '';
  try { sessionStorage.removeItem(KEY); } catch { /* nada */ }
  showPanel(false);
  if (clearMessage) say(null);
}
$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  adminKey = $('key').value;
  try {
    await api('/status');
    try { sessionStorage.setItem(KEY, adminKey); } catch { /* nada */ }
    $('key').value = '';
    say(null);
    showPanel(true);
    await load();
  } catch (err) {
    adminKey = '';
    say('error', err.message);
  }
});
$('logout').addEventListener('click', () => logout());

/* ---------- Lista y mapa ---------- */
async function load() {
  places = (await api('/places')).places;
  renderList();
  renderMarkers();
}
function renderMarkers() {
  layer.clearLayers();
  for (const p of places) {
    L.marker([p.lat, p.lon], { icon: pin(KINDS[p.kind][0]) })
      .bindPopup(`<b>${escapeHtml(p.name)}</b><br>${escapeHtml(KINDS[p.kind][1])}`)
      .on('click', () => startEdit(p))
      .addTo(layer);
  }
}
function renderList() {
  $('count').textContent = `(${places.length})`;
  const body = document.querySelector('#list tbody');
  body.replaceChildren();
  if (!places.length) {
    body.append(el('tr', {}, el('td', { colspan: '4', text: 'Todavía no hay lugares. Haz clic en el mapa para agregar el primero.' })));
    return;
  }
  for (const p of places) {
    const edit = el('button', { type: 'button', text: 'Editar' });
    const del = el('button', { type: 'button', text: 'Eliminar' });
    edit.addEventListener('click', () => startEdit(p));
    del.addEventListener('click', () => remove(p));
    body.append(el('tr', {},
      el('td', { text: p.name }),
      el('td', { text: `${KINDS[p.kind][0]} ${KINDS[p.kind][1]}` }),
      el('td', { text: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` }),
      el('td', { class: 'btns' }, edit, ' ', del),
    ));
  }
}

/* ---------- Formulario ---------- */
function setPoint(lat, lon, center = false) {
  $('lat').value = Number(lat).toFixed(6);
  $('lon').value = Number(lon).toFixed(6);
  if (!pending) {
    pending = L.marker([lat, lon], { draggable: true, icon: pin('📍'), zIndexOffset: 1000 }).addTo(map);
    pending.on('dragend', () => { const ll = pending.getLatLng(); setPoint(ll.lat, ll.lng); });
  } else {
    pending.setLatLng([lat, lon]);
  }
  if (center) map.setView([lat, lon], Math.max(map.getZoom(), 13));
}
function resetForm() {
  editingId = null;
  $('form').reset();
  $('form-title').textContent = 'Nuevo lugar';
  $('cancel').hidden = true;
  $('delete').hidden = true;
  if (pending) { map.removeLayer(pending); pending = null; }
}
function startEdit(p) {
  editingId = p.id;
  $('form-title').textContent = `Editando: ${p.name}`;
  $('name').value = p.name;
  $('kind').value = p.kind;
  $('phone').value = p.phone || '';
  $('hours').value = p.openingHours || '';
  $('notes').value = p.notes || '';
  $('cancel').hidden = false;
  $('delete').hidden = false;
  setPoint(p.lat, p.lon, true);
  say(null);
  $('form').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}
function readForm() {
  return {
    name: $('name').value, kind: $('kind').value, lat: Number($('lat').value), lon: Number($('lon').value),
    phone: $('phone').value, openingHours: $('hours').value, notes: $('notes').value,
  };
}

map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng));
['lat', 'lon'].forEach((id) => $(id).addEventListener('change', () => {
  const lat = Number($('lat').value), lon = Number($('lon').value);
  if ($('lat').value !== '' && $('lon').value !== '' && Number.isFinite(lat) && Number.isFinite(lon)) setPoint(lat, lon, true);
}));

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('lat').value === '' || $('lon').value === '') return say('error', 'Elige la ubicación haciendo clic en el mapa.');
  $('save').disabled = true;
  try {
    const wasEditing = editingId !== null;
    const saved = wasEditing ? await api(`/places/${editingId}`, { method: 'PUT', body: readForm() }) : await api('/places', { method: 'POST', body: readForm() });
    resetForm();
    await load();
    say('ok', `${wasEditing ? 'Cambios guardados' : 'Lugar agregado'}: ${saved.name}. Ya aparece en las rutas que pasen cerca.`);
  } catch (err) {
    say('error', err.message);
  } finally {
    $('save').disabled = false;
  }
});
$('cancel').addEventListener('click', () => { resetForm(); say(null); });
$('delete').addEventListener('click', () => { const p = places.find((x) => x.id === editingId); if (p) remove(p); });
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return say('error', 'Tu navegador no permite obtener la ubicación.');
  navigator.geolocation.getCurrentPosition(
    (pos) => setPoint(pos.coords.latitude, pos.coords.longitude, true),
    () => say('error', 'No se pudo obtener tu ubicación. Revisa el permiso del navegador.'),
    { timeout: 10000 }
  );
});

async function remove(p) {
  if (!window.confirm(`¿Eliminar «${p.name}»? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/places/${p.id}`, { method: 'DELETE' });
    if (editingId === p.id) resetForm();
    await load();
    say('ok', `Lugar eliminado: ${p.name}.`);
  } catch (err) {
    say('error', err.message);
  }
}

/* ---------- Inicio: reutiliza la clave de la sesión si existe ---------- */
(async () => {
  if (!adminKey) return;
  try {
    await api('/status');
    showPanel(true);
    await load();
  } catch (err) {
    say('error', err.message);
  }
})();
