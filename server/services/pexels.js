// Pexels: fotos del destino. Requiere PEXELS_API_KEY (solo vive en el backend).

const { fetchJson, HttpError } = require('../utils/http');

const BASE = 'https://api.pexels.com/v1/search';

async function getPhotos(query, perPage = 6) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new HttpError(502, 'PEXELS_API_KEY no está configurada en el servidor');

  const url = `${BASE}?${new URLSearchParams({ query, per_page: String(perPage), orientation: 'landscape' })}`;
  const data = await fetchJson(url, { headers: { Authorization: key } });

  return (data.photos || []).map((p) => ({
    id: p.id,
    url: p.src?.large,
    thumb: p.src?.medium,
    alt: p.alt || query,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pexelsUrl: p.url,
  }));
}

module.exports = { getPhotos };
