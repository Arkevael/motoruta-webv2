# Guía: subir MotoRuta Web a Vercel con base de datos (Neon)

## 1. Base de datos (Neon)
1. Crea cuenta en https://neon.tech y un proyecto nuevo (región: la más cercana, p. ej. US East).
2. En **Dashboard → Connect**, activa **Connection pooling** y copia la cadena `postgresql://...-pooler...`.
3. No crees tablas: la app crea la tabla `places` sola la primera vez que se usa el panel admin.

## 2. GitHub
Repositorio nuevo y vacío (sin README). En la carpeta del proyecto:
    git init
    git add .
    git commit -m "MotoRuta Web"
    git branch -M main
    git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
    git push -u origin main

## 3. Vercel
1. https://vercel.com → Add New → Project → importa el repositorio.
2. ANTES de pulsar Deploy abre **Framework Preset** y elige **Other**. Deja Build/Output/Install sin tocar.
3. En **Environment Variables** agrega:
   - DATABASE_URL = cadena de Neon (pooled)
   - ADMIN_PASSWORD = mínimo 8 caracteres
   - PEXELS_API_KEY = clave de https://www.pexels.com/api
   - NOMINATIM_USER_AGENT = MotoRuta/1.0 (tucorreo@ejemplo.com)
   - GEOAPIFY_API_KEY = clave gratuita de https://www.geoapify.com (recomendada: grifos/talleres/miradores más estables; sin ella se usa solo Overpass)
4. Deploy.

## 4. Comprobar
- /api/health  → debe responder ok
- /            → buscar una ruta (Cusco → Ollantaytambo)
- /admin.html  → entrar con ADMIN_PASSWORD; el estado debe decir que la base de datos está conectada.
  Agrega un taller de prueba y haz una ruta cerca para verlo en el mapa.

## 5. Actualizar
    git add . && git commit -m "cambio" && git push
Vercel redespliega solo.

## Problemas frecuentes
- "Container service must specify an entrypoint": el Framework Preset está en Container → Settings → General → Framework Preset = Other (activar Override) y Redeploy sin caché.
- Admin dice "base de datos no configurada": falta DATABASE_URL o tiene error. Corrígela en Settings → Environment Variables y haz Redeploy (las variables solo se aplican en deploys nuevos).
- Error de conexión SSL: usa la cadena de Neon tal cual (con sslmode=require); la app ya maneja SSL.
- Rutas lentas o con aviso de Overpass: es normal a veces (servicio público); reintenta.
