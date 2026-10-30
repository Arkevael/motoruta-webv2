// Caché en memoria con expiración (TTL) y tamaño máximo.

class TTLCache {
  constructor(ttlMs, maxEntries = 200) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  clear() {
    this.store.clear();
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries) {
      // elimina la entrada más antigua (Map conserva el orden de inserción)
      this.store.delete(this.store.keys().next().value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

module.exports = { TTLCache };
