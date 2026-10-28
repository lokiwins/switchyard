/**
 * Stale-while-revalidate cache. The first call for a key waits for `load`;
 * afterwards the last good value is returned immediately and refreshed in the
 * background once it is older than `ttlMs`.
 */
export function createSwrCache({ now = Date.now } = {}) {
  const entries = new Map();

  function refresh(key, load) {
    const existing = entries.get(key);
    if (existing?.pending) return existing.pending;

    const pending = load()
      .then((value) => {
        entries.set(key, { value, error: null, loadedAt: now(), pending: null });
        return value;
      })
      .catch((error) => {
        const prev = entries.get(key);
        entries.set(key, { ...prev, error, loadedAt: now(), pending: null });
        if (prev && 'value' in prev) return prev.value;
        throw error;
      });

    entries.set(key, { ...existing, pending });
    return pending;
  }

  async function get(key, ttlMs, load, { force = false } = {}) {
    const entry = entries.get(key);
    const hasValue = entry && 'value' in entry;
    if (!hasValue || force) return refresh(key, load);
    if (now() - entry.loadedAt > ttlMs) refresh(key, load).catch(() => {});
    return entry.value;
  }

  function lastError(key) {
    return entries.get(key)?.error ?? null;
  }

  /** Drop a key so the next get reloads it. */
  function invalidate(key) {
    entries.delete(key);
  }

  return { get, lastError, invalidate };
}
