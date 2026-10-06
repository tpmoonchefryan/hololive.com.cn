// A release replaces every hashed chunk, so a page still running the previous build fails to load
// lazy routes. Vite then dispatches "vite:preloadError"; reload once to fetch the current index.html.
// A reload within the last 10 s, or no usable sessionStorage, leaves the error to surface (no loop).
const RELOAD_KEY = "hololive:chunk-reload-at";
const RELOAD_WINDOW_MS = 10_000;

export function reloadOnceOnPreloadError(event, win = window, now = Date.now()) {
  try {
    const storage = win.sessionStorage;
    const last = storage.getItem(RELOAD_KEY);
    const elapsed = now - Number(last);
    if (last !== null && elapsed >= 0 && elapsed < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  event.preventDefault();
  win.location.reload();
  return true;
}
