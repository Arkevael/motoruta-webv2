// Conexión a Postgres (Neon, Supabase u otro) mediante DATABASE_URL.
// Si DATABASE_URL no está definida, la app funciona igual pero sin lugares agregados a mano.

const fs = require('fs');
const path = require('path');

let pool = null;
let schemaReady = null;

function isConfigured() {
  return Boolean(pool || process.env.DATABASE_URL);
}

function buildPool() {
  const { Pool } = require('pg');
  const url = new URL(process.env.DATABASE_URL);
  // Neon/Supabase añaden sslmode/channel_binding a la URL; el SSL se configura aquí explícitamente.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const useSsl = process.env.DATABASE_SSL ? process.env.DATABASE_SSL !== 'false' : !local;
  return new Pool({
    connectionString: url.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: process.env.VERCEL ? 3 : 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Neon puede tardar al «despertar» tras estar inactiva
  });
}

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = buildPool();
    pool.on('error', (err) => console.error('Error en el pool de Postgres:', err.message));
  }
  return pool;
}

/** Ejecuta una consulta; crea el esquema la primera vez. Lanza si no hay base configurada. */
async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL no está configurada');
  if (!schemaReady) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    schemaReady = p.query(sql).catch((err) => {
      schemaReady = null; // reintenta en la próxima consulta
      throw err;
    });
  }
  await schemaReady;
  return p.query(text, params);
}

/** Solo para pruebas: inyecta un pool (p. ej. pg-mem) o null para desactivar la base. */
function __setPoolForTests(p) {
  pool = p;
  schemaReady = null;
}

module.exports = { query, isConfigured, __setPoolForTests };
