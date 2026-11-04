/**
 * Small persistent cache (localStorage) used for stale-while-revalidate loading:
 * pages render the last good data instantly, then refresh it in the background.
 * Every call is defensive — private mode, full storage or corrupt JSON never break the app.
 */
const PREFIX = 'rykoc-cache:v1:';

export function readPersisted<T>(key: string, maxAgeMs: number): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as { at: number; value: T };
    if (!entry || typeof entry.at !== 'number' || Date.now() - entry.at > maxAgeMs) return undefined;
    return entry.value;
  } catch { return undefined; }
}

export function writePersisted(key: string, value: unknown) {
  const payload = JSON.stringify({ at: Date.now(), value });
  try { localStorage.setItem(PREFIX + key, payload); }
  catch {
    // Storage full: drop our own older cache entries and try once more.
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
      localStorage.setItem(PREFIX + key, payload);
    } catch { /* give up silently; the network path still works */ }
  }
}
