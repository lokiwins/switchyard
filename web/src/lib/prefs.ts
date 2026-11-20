/* This browser's small preferences. Storage can be off (a private window); they're conveniences, so failures are ignored. */

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // A preference is a convenience.
  }
}
