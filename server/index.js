const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const routeRouter = require('./routes/route');
const adminRouter = require('./routes/admin');
const db = require('./db');
const { HttpError } = require('./utils/http');
const pkg = require('../package.json');

const app = express();
app.disable('x-powered-by');
app.locals.clearRouteCache = () => routeRouter.clearCache();
app.set('trust proxy', 1); // Render/Railway/Fly están detrás de un proxy

// Cabeceras de seguridad. Notas:
//  - Referrer-Policy NO puede ser "no-referrer": los servidores de teselas de OpenStreetMap exigen Referer.
//  - CSP permite solo lo que usa la app: Leaflet local, teselas de OSM e imágenes de Pexels.
app.use(
  helmet({
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://images.pexels.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null, // evita problemas al probar en http://localhost
      },
    },
  })
);
app.use(compression());

// Registro simple de peticiones a la API
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'test') return next();
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start} ms)`);
  });
  next();
});

// Health check (antes del limitador: lo usan Render y los monitores de uptime)
app.get('/api/health', (req, res) =>
  res.json({
    status: 'ok',
    version: pkg.version,
    uptimeSeconds: Math.round(process.uptime()),
    demoMode: process.env.DEMO_MODE === 'true',
    pexelsConfigured: Boolean(process.env.PEXELS_API_KEY),
    databaseConfigured: db.isConfigured(), // no se consulta la base aquí: así Neon puede suspenderse
    adminEnabled: Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8),
  })
);

// Límite de peticiones por IP (protege las cuotas de las APIs externas)
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests', message: 'Demasiadas peticiones. Intenta de nuevo en un minuto.' },
  })
);

app.use('/api/route', routeRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Endpoint no encontrado' }));

// Leaflet se sirve desde node_modules (sin depender de un CDN) y el frontend desde public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Manejador central de errores: respuesta JSON uniforme, sin trazas internas
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request', message: 'El cuerpo no es un JSON válido' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'El cuerpo es demasiado grande' });
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`MotoRuta Web v${pkg.version} escuchando en http://localhost:${port}`);
    if (process.env.DEMO_MODE === 'true') console.warn('⚠ DEMO_MODE activo: se devuelven datos de ejemplo.');
    else if (!process.env.PEXELS_API_KEY) console.warn('⚠ PEXELS_API_KEY no configurada: no se mostrarán fotos.');
    if (!process.env.DATABASE_URL) console.warn('ℹ DATABASE_URL no configurada: no hay lugares agregados a mano.');
    if (process.env.DATABASE_URL && !(process.env.ADMIN_PASSWORD?.length >= 8)) console.warn('ℹ ADMIN_PASSWORD (mín. 8 caracteres) no definida: el panel /admin.html está deshabilitado.');
  });
  // Cierre ordenado cuando el hosting reinicia o detiene el servicio
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = app;
