-- Esquema de MotoRuta Web (Postgres: Neon, Supabase o cualquier otro).
-- La app lo crea sola al primer uso; este archivo es por si prefieres ejecutarlo a mano
-- (Neon: SQL Editor · Supabase: SQL Editor).

CREATE TABLE IF NOT EXISTS places (
  id            SERIAL PRIMARY KEY,
  name          TEXT             NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  kind          TEXT             NOT NULL CHECK (kind IN ('moto', 'auto', 'grifo', 'mirador')),
  lat           DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon           DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  phone         TEXT,
  opening_hours TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS places_lat_lon_idx ON places (lat, lon);
