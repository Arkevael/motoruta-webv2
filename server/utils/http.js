// Utilidades HTTP: errores tipados y fetch con timeout.

const CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  404: 'not_found',
  429: 'too_many_requests',
  502: 'upstream_error',
  503: 'service_unavailable',
  504: 'upstream_timeout',
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = CODES[status] || 'internal_error';
    Object.assign(this, extra);
  }
}

/**
 * GET/POST JSON con timeout. Convierte cualquier fallo de red
 * en un HttpError 502/504 para que el backend responda de forma uniforme.
 */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  const host = new URL(url).hostname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      let parsed = null;
      try { parsed = await res.json(); } catch { /* sin cuerpo JSON */ }
      throw new HttpError(502, `${host} respondió con estado ${res.status}`, {
        upstreamStatus: res.status,
        upstreamBody: parsed,
      });
    }
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === 'AbortError') throw new HttpError(504, `Tiempo de espera agotado al consultar ${host}`);
    throw new HttpError(502, `No se pudo contactar con ${host}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { HttpError, fetchJson };
