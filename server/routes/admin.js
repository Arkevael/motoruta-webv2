// Panel de administración: alta, edición y baja de lugares propios (protegido con ADMIN_PASSWORD).

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../utils/http');
const db = require('../db');
const places = require('../services/manualPlaces');

const router = express.Router();

// Solo cuentan las claves incorrectas (401): 10 cada 15 minutos por IP.
// Los errores de validación (400/404) no cuentan, para no bloquear a quien edita con normalidad.
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests', message: 'Demasiados intentos fallidos. Espera unos minutos.' },
  })
);
router.use(express.json({ limit: '10kb' }));

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

router.use((req, res, next) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    return next(new HttpError(503, 'Panel deshabilitado: define ADMIN_PASSWORD (mínimo 8 caracteres) en el servidor'));
  }
  if (!safeEqual(req.get('x-admin-key') || '', password)) return next(new HttpError(401, 'Clave incorrecta'));
  next();
});

router.use((req, res, next) => {
  if (!db.isConfigured()) return next(new HttpError(503, 'Base de datos no configurada: define DATABASE_URL en el servidor'));
  next();
});

const clean = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (/[\u0000-\u001f]/.test(s.replace(/\n/g, ' '))) throw new HttpError(400, 'Hay caracteres no válidos en el formulario');
  if (s.length > max) throw new HttpError(400, `Un campo supera los ${max} caracteres`);
  return s || null;
};

function parsePlace(body) {
  const name = clean(body.name, 100);
  if (!name || name.length < 2) throw new HttpError(400, 'El nombre debe tener entre 2 y 100 caracteres');
  if (!places.KINDS.includes(body.kind)) throw new HttpError(400, `El tipo debe ser uno de: ${places.KINDS.join(', ')}`);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'Latitud inválida (-90 a 90)');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new HttpError(400, 'Longitud inválida (-180 a 180)');
  return { name, kind: body.kind, lat, lon, phone: clean(body.phone, 30), openingHours: clean(body.openingHours, 100), notes: clean(body.notes, 300) };
}

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Identificador inválido');
  return id;
};

// Tras cualquier cambio se vacía la caché de rutas para que se vea de inmediato
const changed = (req) => req.app.locals.clearRouteCache?.();

router.get('/status', (req, res) => res.json({ ok: true }));
router.get('/places', async (req, res, next) => {
  try { res.json({ places: await places.listAll() }); } catch (e) { next(e); }
});
router.post('/places', async (req, res, next) => {
  try {
    const created = await places.create(parsePlace(req.body || {}));
    changed(req);
    res.status(201).json(created);
  } catch (e) { next(e); }
});
router.put('/places/:id', async (req, res, next) => {
  try {
    const updated = await places.update(parseId(req.params.id), parsePlace(req.body || {}));
    if (!updated) throw new HttpError(404, 'Lugar no encontrado');
    changed(req);
    res.json(updated);
  } catch (e) { next(e); }
});
router.delete('/places/:id', async (req, res, next) => {
  try {
    if (!(await places.remove(parseId(req.params.id)))) throw new HttpError(404, 'Lugar no encontrado');
    changed(req);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
