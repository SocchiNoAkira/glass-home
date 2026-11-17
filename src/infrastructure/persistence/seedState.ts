/**
 * Whether the curated starter shortcuts have already been handed out.
 *
 * The 20 presets are a first-install experience, not content that should come
 * back every time the workspace is recreated. The marker cannot live in
 * IndexedDB: "clear all data" wipes every store there, so the very next load
 * would look like a fresh install and rebuild the presets — which is the
 * behaviour this marker exists to stop. `localStorage` belongs to the extension
 * origin, survives that clear, and is removed together with the extension.
 */
const SEEDED_KEY = 'glass-home.seeded.v1';

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Storage can be blocked (private mode, hardened profile). Seeding again is
    // an acceptable degradation; failing to load the app is not.
    return undefined;
  }
}

export function hasSeededShortcuts(): boolean {
  try {
    return storage()?.getItem(SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markShortcutsSeeded(): void {
  try {
    storage()?.setItem(SEEDED_KEY, '1');
  } catch {
    /* see storage(): non-fatal */
  }
}
