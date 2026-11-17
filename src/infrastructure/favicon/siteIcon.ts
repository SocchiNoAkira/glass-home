/**
 * Site icons, resolved through the browser's own favicon store.
 *
 * `chrome-extension://<id>/_favicon/?pageUrl=…` is served by Chromium from the
 * icons the browser already cached while the user browsed. That is deliberate:
 *
 * - fetching `https://site/favicon.ico` ourselves would need `<all_urls>` host
 *   permission and would ping every site on every new tab, which this project
 *   does not do;
 * - the alternative of an `<img src="https://site/favicon.ico">` still makes a
 *   network request per shortcut and cannot be validated or cached;
 * - this route adds exactly one narrow permission (`favicon`), makes **no**
 *   network requests, and reads nothing about the user's history beyond the
 *   per-URL icon the browser is asked for.
 *
 * Unknown sites do not fail: Chromium answers with a generic globe. Returning
 * that would replace every unmatched shortcut's initial with the same grey
 * circle, so the generic icon is fingerprinted once per session and treated as
 * "no icon". The shortcut then keeps its letter until the site has been opened
 * once, after which the real icon exists in the store.
 */

/**
 * Pixels requested from the store.
 *
 * 32 is what the favicon database actually holds for a 16px/32px site favicon;
 * asking for 64 makes Chromium answer with the generic globe when it has no
 * bitmap that large, which would hide real icons. 32 is displayed at ~37px
 * (66% of a 56px tile), so the upscale stays mild.
 */
const ICON_SIZE = 32;

/** Page URL whose icon can never exist, used to fingerprint the generic icon. */
const IMPOSSIBLE_PAGE = 'https://glass-home.invalid/no-icon';

const results = new Map<string, Promise<Uint8Array | undefined>>();
let genericIcon: Promise<Uint8Array | undefined> | undefined;

/**
 * Page URLs to ask about, most specific first.
 *
 * The store is keyed by page URL, not by host: visiting `site.com/` does not
 * give `site.com/app` an icon. Asking for the exact URL first keeps per-page
 * icons (docs sites, apps) working, and the origin is the practical fallback
 * for everything else.
 */
export function faviconCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
    const exact = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const origin = `${parsed.origin}/`;
    return exact === origin ? [origin] : [exact, origin];
  } catch {
    return [];
  }
}

/** `chrome-extension://<id>` of this extension, or `undefined` outside one. */
function extensionOrigin(): string | undefined {
  const runtime = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
  if (runtime?.id) return `chrome-extension://${runtime.id}`;
  // Test pages and the sandbox have no `chrome.runtime`; the page URL still
  // identifies the extension when it is our own new-tab page.
  if (location.protocol === 'chrome-extension:') return `chrome-extension://${location.host}`;
  return undefined;
}

function faviconUrl(origin: string, pageUrl: string): string {
  return `${origin}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${ICON_SIZE}`;
}

async function bytesOf(url: string): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function genericIconBytes(origin: string): Promise<Uint8Array | undefined> {
  genericIcon ??= bytesOf(faviconUrl(origin, IMPOSSIBLE_PAGE));
  return genericIcon;
}

/**
 * Resolves a displayable icon URL for one shortcut, or `undefined` when the
 * browser has no real icon for it yet (the caller keeps its letter).
 *
 * Results are cached per icon URL for the lifetime of the page: a grid with 20
 * shortcuts must not re-read the same bytes on every render.
 */
export async function resolveSiteIcon(url: string): Promise<string | undefined> {
  const origin = extensionOrigin();
  if (!origin) return undefined;
  const candidates = faviconCandidates(url);
  if (candidates.length === 0) return undefined;

  const generic = await genericIconBytes(origin);
  for (const candidate of candidates) {
    const src = faviconUrl(origin, candidate);
    let pending = results.get(src);
    if (!pending) {
      pending = bytesOf(src);
      results.set(src, pending);
    }
    const bytes = await pending;
    if (!bytes) continue;
    if (generic && sameBytes(bytes, generic)) continue;
    return src;
  }
  return undefined;
}
