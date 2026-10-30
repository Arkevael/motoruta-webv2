// Open-Meteo: clima actual, pronóstico por hora y orto/ocaso en varios puntos del trayecto.

const { fetchJson, HttpError } = require('../utils/http');

const BASE = 'https://api.open-meteo.com/v1/forecast';

// Códigos WMO → texto e icono
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
  const alerts = [];
  if ((p.rainProbability ?? 0) >= 60 || (p.precipitation ?? 0) > 0.5) alerts.push('Probabilidad alta de lluvia: calzada resbaladiza');
  if ((p.windSpeed ?? 0) >= 40) alerts.push('Viento fuerte: cuidado con las ráfagas');
  if (p.temperature !== null && p.temperature <= 3) alerts.push('Riesgo de hielo o frío extremo: abrígate');
  if (p.weatherCode === 45 || p.weatherCode === 48) alerts.push('Poca visibilidad por niebla');
  if (p.weatherCode >= 95) alerts.push('Tormenta eléctrica: evita viajar');
  return alerts;
}

/** points: [{ label, lat, lon, fraction, km }] */
async function getWeather(points) {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lon.toFixed(4)).join(','),
    current: 'temperature_2m,precipitation,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    forecast_days: '2',
    timezone: 'auto',
  });
  const raw = await fetchJson(`${BASE}?${params}`);
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length !== points.length) throw new HttpError(502, 'Respuesta inesperada de api.open-meteo.com');

  return list.map((r, i) => {
    const code = r.current?.weather_code ?? null;
    const info = weatherInfo(code);
    const daily = r.daily || {};
    const h = r.hourly || {};
    const point = {
      label: points[i].label,
      lat: points[i].lat,
      lon: points[i].lon,
      fraction: points[i].fraction,
      km: points[i].km,
      temperature: r.current?.temperature_2m ?? null,
      windSpeed: r.current?.wind_speed_10m ?? null,
      precipitation: r.current?.precipitation ?? null,
      weatherCode: code,
      description: info.text,
      icon: info.icon,
      rainProbability: daily.precipitation_probability_max?.[0] ?? null,
      sunrise: daily.sunrise?.[0] ?? null,
      sunset: daily.sunset?.[0] ?? null,
      utcOffsetSeconds: r.utc_offset_seconds ?? null,
      sun: (daily.time || []).map((date, d) => ({ date, sunrise: daily.sunrise?.[d] ?? null, sunset: daily.sunset?.[d] ?? null })),
      // pronóstico por hora (hoy y mañana, hora local del punto) para calcular el clima a la hora de llegada
      hourly: {
        time: h.time || [],
        temperature: h.temperature_2m || [],
        rainProbability: h.precipitation_probability || [],
        weatherCode: h.weather_code || [],
        windSpeed: h.wind_speed_10m || [],
      },
    };
    point.alerts = alertsFor(point);
    return point;
  });
}

module.exports = { getWeather, weatherInfo, alertsFor };
