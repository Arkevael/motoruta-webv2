// Fotos del destino. Unsplash (si hay UNSPLASH_ACCESS_KEY) con Pexels como respaldo (PEXELS_API_KEY).
// Las claves solo viven en el backend. Forma común: { id, url, thumb, alt, photographer, photographerUrl, sourceUrl, source }.

const { fetchJson, HttpError } = require('../utils/http');

const UTM = 'utm_source=motoruta_web&utm_medium=referral'; // Unsplash exige enlazar al autor y a Unsplash con estos parámetros
const withUtm = (u) => (u ? `${u}${u.includes('?') ? '&' : '?'}${UTM}` : u);

async function fromUnsplash(query, perPage) {
  const url = `https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: String(perPage), orientation: 'landscape' })}`;
  const data = await fetchJson(url, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' } });
  return (data.results || []).map((p) => ({
    id: `unsplash-${p.id}`,
    url: p.urls?.regular,
    thumb: p.urls?.small,
    alt: p.alt_description || p.description || query,
    photographer: p.user?.name,
    photographerUrl: withUtm(p.user?.links?.html),
    sourceUrl: withUtm(p.links?.html),
    source: 'Unsplash',
  }));
}

async function fromPexels(query, perPage) {
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: String(perPage), orientation: 'landscape' })}`;
  const data = await fetchJson(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  return (data.photos || []).map((p) => ({
    id: `pexels-${p.id}`,
    url: p.src?.large,
    thumb: p.src?.medium,
    alt: p.alt || query,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    sourceUrl: p.url,
    source: 'Pexels',
  }));
}

async function getPhotos(query, perPage = 6) {
  const providers = [];
  if (process.env.UNSPLASH_ACCESS_KEY) providers.push(['Unsplash', fromUnsplash]);
  if (process.env.PEXELS_API_KEY) providers.push(['Pexels', fromPexels]);
  if (!providers.length) throw new HttpError(502, 'No hay clave de fotos configurada (UNSPLASH_ACCESS_KEY o PEXELS_API_KEY)');

  const errors = [];
  for (const [name, fn] of providers) {
    try {
      const photos = await fn(query, perPage);
      if (photos.length) return photos;
      errors.push(`${name}: sin resultados`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  // Si algún proveedor respondió sin resultados y ninguno falló de verdad, no es un error: simplemente no hay fotos.
  if (errors.every((e) => e.endsWith('sin resultados'))) return [];
  throw new HttpError(502, errors.join(' · '));
}

module.exports = { getPhotos };
