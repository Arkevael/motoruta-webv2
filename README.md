# MotoRuta Web

Aplicación web para planificar viajes en moto. Con un origen y un destino devuelve, en una sola consulta, la **ruta**, el **clima del trayecto**, los **talleres mecánicos y miradores** cercanos y **fotos del destino**.

Stack: Node.js 20 + Express + dotenv, frontend HTML/CSS/JS vanilla, Leaflet + OpenStreetMap. Sin base de datos (caché en memoria de 5 min).

## Funciones

**Del proyecto base:** ruta en mapa, distancia y duración, clima en 4 puntos del trayecto con alertas (lluvia, viento, frío, niebla, tormenta), talleres (los de moto primero) y miradores con su kilómetro del recorrido, galería de fotos con crédito.

**Añadidas:**
- ⛽ **Grifos en la ruta** (Overpass) con el kilómetro de cada uno y **aviso de tramos largos sin grifos** según la autonomía de tu tanque (con 20 % de margen, asumiendo tanque lleno al salir).
- ⛰️ **Perfil de elevación** (Open-Meteo): gráfico interactivo (al pasar el cursor o el dedo se mueve un punto sobre el mapa), altitud máxima/mínima, subida y bajada acumuladas y avisos de altura (soroche, frío, descensos largos).
- 🌦️ **Clima a la hora en que llegarías a cada tramo** (pronóstico por hora de hoy o mañana, según la hora de salida que elijas), con alertas de lluvia, viento, frío, niebla y tormenta.
- ⭐ **Rutas favoritas** guardadas en el navegador (localStorage): no requieren base de datos ni cuenta. Solo existen en ese dispositivo y navegador.
- 📌 **Lugares agregados a mano** (talleres, grifos y miradores) desde un panel de administración, guardados en Postgres (Neon o Supabase). Se suman a los de OpenStreetMap; si coinciden, gana el manual.
- 📍 Usar mi ubicación como origen.
- 🕒 Hora de salida (hoy/mañana) → llegada estimada y aviso si llegarías de noche (con la hora límite de salida para llegar con luz).
- ⛽ Estimación de combustible (rendimiento y precio editables, se recuerdan).
- ⬇️ Descargar la ruta en GPX (con talleres y miradores como waypoints) y 🗺️ abrir en Google Maps.
- 🔗 Enlaces compartibles (`/?from=Cusco&to=Ollantaytambo`) y búsquedas recientes.
- Geocodificador de respaldo (Photon) si Nominatim bloquea la IP del hosting.
- Modo demostración sin internet (`DEMO_MODE=true`).
- Seguridad: Helmet (CSP), rate limiting, validación, errores uniformes. Leaflet se sirve desde el propio servidor (sin CDN).

## APIs usadas (todas gratuitas)

| API | Uso | Key |
|---|---|---|
| Nominatim | Geocodificar origen/destino | No (User-Agent obligatorio) |
| OSRM | Ruta, distancia y duración | No |
| Overpass | Talleres, grifos y miradores | No |
| Open-Meteo | Clima actual y por hora, amanecer/atardecer y elevación | No |
| Pexels | Fotos del destino | Sí (gratis, sin tarjeta) |
| Photon (respaldo) | Geocodificar si falla Nominatim | No |
| Postgres (Neon / Supabase) | Lugares agregados a mano | `DATABASE_URL` (opcional) |

## Puesta en marcha local

```bash
npm install
cp server/.env.example server/.env   # Windows: copy server\.env.example server\.env
# edita server/.env: PEXELS_API_KEY y NOMINATIM_USER_AGENT (con tu correo)
npm start
```

Abre http://localhost:3000. Sin `PEXELS_API_KEY` todo funciona, salvo las fotos.
Para probar sin internet: `DEMO_MODE=true npm start`.

## Diseño

Identidad inspirada en la señalización vial y la topografía andina: letrero verde de carretera para el buscador, amarillo de línea de eje como acento, asfalto como estructura y curvas de nivel de fondo. Soporta modo claro y oscuro automático, es responsivo, respeta «reducir movimiento» y tiene foco de teclado visible.

- Tipografía **Barlow** y **Barlow Condensed** (licencia SIL OFL, incluida en `public/fonts/`), servida desde el propio servidor: no depende de Google Fonts ni de ningún CDN.
- La ruta se dibuja como una carretera (borde de asfalto y línea amarilla). Mientras se calcula, la línea de la cabecera «avanza».
- Los avisos de precaución usan un cartel amarillo; las categorías de lugares usan el color de su señal (amarillo, azul, verde).
- Los estilos están en `public/style.css`, organizados por secciones y con variables al inicio (`:root`) para cambiar colores y fuentes fácilmente.

## Lugares agregados a mano (Postgres)

OpenStreetMap no tiene todo: en zonas rurales faltan talleres, grifos y miradores. El panel `/admin.html` permite agregarlos, editarlos y borrarlos. Aparecen en las rutas que pasan a menos de 3 km (configurable) con la marca «📌 manual», y reemplazan al lugar de OpenStreetMap si es el mismo (menos de 60 m, o igual nombre a menos de 500 m).

**1. Crear la base de datos gratuita** (elige una; la app usa el driver estándar `pg`, así que funcionan igual):

- **Neon** (recomendada): crea una cuenta y un proyecto en neon.tech → en *Connection details* copia la cadena de conexión (`postgresql://usuario:clave@ep-xxxx...neon.tech/neondb?sslmode=require`).
- **Supabase**: crea un proyecto en supabase.com → *Connect* → copia la cadena de conexión. Usa la del **Session pooler** (compatible con IPv4); la conexión directa puede ser solo IPv6 y fallar en algunos hostings. Reemplaza `[YOUR-PASSWORD]` por la clave de tu base.

**2. Configurar el servidor** (en `server/.env` local, y en *Environment* de Render):

```
DATABASE_URL=postgresql://...        # la cadena del paso 1
ADMIN_PASSWORD=una-clave-larga-y-unica   # mínimo 8 caracteres
```

La tabla `places` se crea sola la primera vez (también está en `db/schema.sql` por si prefieres ejecutarla a mano en el editor SQL del proveedor).

**3. Usar el panel**: abre `/admin.html`, entra con `ADMIN_PASSWORD`, haz clic en el mapa para elegir la ubicación y llena el formulario. Los cambios se ven de inmediato en las rutas.

Notas:
- Los planes gratuitos cambian con el tiempo: confirma en la web de cada proveedor que no pidan tarjeta ni tengan límites que no te sirvan. En general, Neon suspende la base tras unos minutos sin uso (la primera consulta puede tardar un poco más) y Supabase puede pausar proyectos inactivos durante semanas.
- Si la base no responde, las rutas siguen funcionando con OpenStreetMap y se muestra un aviso.
- El panel solo cuenta las claves incorrectas para bloquear fuerza bruta (10 cada 15 minutos por IP). Usa una clave larga y no la compartas.
- `/api/health` no consulta la base a propósito: así Neon puede suspenderse aunque un monitor haga ping.

## Despliegue gratuito

### Render (recomendado, sin tarjeta)

1. Sube el proyecto a GitHub (el `.gitignore` ya excluye `.env` y `node_modules`).
2. En Render: **New → Blueprint**, elige el repositorio (usa `render.yaml`). O bien **New → Web Service** con Build `npm ci --omit=dev` y Start `npm start`.
3. Cuando lo pida, completa `PEXELS_API_KEY` y `NOMINATIM_USER_AGENT` (con tu correo real) y, si usarás lugares manuales, `DATABASE_URL` y `ADMIN_PASSWORD`.
4. Al terminar el despliegue abre la URL pública y comprueba `/api/health`.

El plan gratuito se «duerme» tras ~15 min sin visitas y la primera carga tarda unos segundos. Para evitarlo puedes crear un monitor gratuito (por ejemplo UptimeRobot) que consulte `/api/health` cada 5 minutos.

### Railway / Fly.io / Cloud Run

Incluye `Dockerfile`: se despliega con el flujo normal de cada plataforma. Define las mismas variables de entorno. (Algunas de estas plataformas piden tarjeta o tienen créditos limitados; revisa su plan gratuito vigente.)

### Vercel (+ GitHub con redespliegue automático)

El proyecto ya está adaptado: `api/index.js` exporta la app Express como función serverless, `vercel.json` redirige `/api/*` a esa función y añade cabeceras de seguridad, y Leaflet está incluido en `public/vendor/leaflet` (los estáticos los sirve el CDN de Vercel).

1. Sube el código a GitHub:
   ```bash
   git init && git add . && git commit -m "MotoRuta Web"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/motoruta-web.git
   git push -u origin main
   ```
2. En vercel.com → **Add New → Project** → importa el repositorio. Framework: **Other**. No cambies Build ni Output.
3. En **Settings → Environment Variables** define: `DATABASE_URL` (cadena *pooled* de Neon/Supabase), `ADMIN_PASSWORD` (mín. 8 caracteres), `PEXELS_API_KEY`, `NOMINATIM_USER_AGENT` (con tu correo).
4. **Deploy**. Desde entonces, cada `git push` a `main` redespliega solo; las ramas y los pull requests generan URLs de vista previa.

Limitaciones (serverless): la caché en memoria, el límite de peticiones por IP y el espaciado de Nominatim son **por instancia**, no globales; el primer acceso tras un rato inactivo puede tardar (arranque en frío); y las funciones tienen un tiempo máximo (configurado en 60 s, sujeto al plan). Para una app académica es suficiente; si necesitas un límite global, usa Render o Docker.

## Estructura

```
motoruta-web/
├── server/
│   ├── index.js          # Express: seguridad, rate limit, estáticos, errores, health
│   ├── routes/route.js   # GET /api/route
│   ├── db.js             # conexión a Postgres (DATABASE_URL)
│   ├── routes/admin.js   # API del panel (protegida con ADMIN_PASSWORD)
│   ├── services/         # nominatim, photon, osrm, overpass, openmeteo, elevation, manualPlaces, pexels
│   ├── utils/            # http (timeout), cache (TTL), geo (distancias)
│   ├── demo/sample.js    # datos de ejemplo (DEMO_MODE)
│   └── .env              # claves (NO se sube a Git)
├── public/               # index.html, app.js, admin.html, admin.js, style.css
├── db/schema.sql         # tabla places
├── test/ · testing/      # pruebas (APIs simuladas y Postgres en memoria)
├── Dockerfile · render.yaml · .github/workflows/ci.yml
└── package.json
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/route?from=Cusco&to=Ollantaytambo` | Ruta + clima + talleres + grifos + miradores + elevación + fotos. `from`/`to` aceptan también coordenadas: `-13.53,-71.97` |
| GET | `/api/health` | Estado del servicio (no expone claves) |
| GET/POST | `/api/admin/places` | Listar / crear lugares propios (cabecera `x-admin-key`) |
| PUT/DELETE | `/api/admin/places/:id` | Editar / borrar un lugar propio |

```bash
curl "http://localhost:3000/api/route?from=Cusco&to=Ollantaytambo"
```

Respuesta (resumida): `{ origin, destination, geometry, distance, duration, workshops, fuel, viewpoints, elevation, weather, photos, warnings, cached }`

Códigos: `200` ok · `400` parámetros inválidos · `404` lugar o ruta no encontrados · `429` demasiadas peticiones · `502/504` API externa caída o lenta. Si fallan Overpass, Open-Meteo (clima o elevación) o Pexels, la respuesta sigue siendo `200` con ese bloque vacío y un texto en `warnings`.

## Pruebas

```bash
npm test
```

Cubre el panel (clave, validación, alta/edición/baja, fuerza bruta), los lugares manuales (cercanía, duplicados, caché, base caída), ruta válida, grifos, elevación, clima por hora, caché, coordenadas, respaldo de geocodificación, parámetros inválidos (400), lugar inexistente (404), OSRM caído (502), Overpass, elevación y Pexels caídos (200 degradado), health, cabeceras de seguridad, archivos estáticos y modo demo. Usa APIs simuladas: no gasta cuota.

## Variables de entorno

`PEXELS_API_KEY`, `NOMINATIM_USER_AGENT` (obligatorias en la práctica) · `DATABASE_URL`, `ADMIN_PASSWORD` (lugares manuales) · `DATABASE_SSL` · `PORT` (3000), `CACHE_TTL_SECONDS` (300), `RATE_LIMIT_MAX` (20/min por IP), `SEARCH_RADIUS_METERS` (3000), `DEMO_MODE`, `OVERPASS_URL`, `OSRM_URL`.

## Notas y límites

- OSRM y Overpass públicos son compartidos y pueden ir lentos o caer; por eso hay timeouts, un espejo de Overpass y respuestas degradadas en vez de errores.
- Nominatim permite 1 petición/segundo: el backend las espacia y cachea 1 hora. Un `User-Agent` genérico puede ser bloqueado: usa tu correo real.
- En zonas rurales Overpass puede devolver pocos talleres (depende de lo mapeado en OpenStreetMap).
- La estimación de combustible y la hora de llegada son aproximadas (no cuentan paradas, tráfico ni pendiente).
- Los grifos salen de OpenStreetMap: en zonas rurales hay puntos de venta sin mapear, por eso la app avisa que no hay que depender de ellos sin confirmar.
- La elevación usa un modelo digital de terreno de ~90 m: sirve para ver el perfil y la altura, no para medidas precisas. El desnivel acumulado es aproximado.
- El pronóstico por hora cubre hoy y mañana; si sales más tarde, la app usa las condiciones actuales y lo indica.
- Las fotos requieren mostrar crédito al fotógrafo y a Pexels (ya incluido).
