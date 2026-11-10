import type { WorkspaceSettings } from '@/src/domain/workspace/model';

export const SEARCH_ENGINES = {
  google: { label: 'Google', shortLabel: 'G', template: 'https://www.google.com/search?q={query}' },
  bing: { label: 'Bing', shortLabel: 'B', template: 'https://www.bing.com/search?q={query}' },
  baidu: { label: '百度', shortLabel: '百', template: 'https://www.baidu.com/s?wd={query}' },
  duckduckgo: { label: 'DuckDuckGo', shortLabel: 'D', template: 'https://duckduckgo.com/?q={query}' },
} as const;

export type SearchResult =
  | { ok: true; url: string; kind: 'search' | 'url' }
  | { ok: false; message: string };

export function parseSafeHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!url.hostname || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function validateSearchTemplate(template: string): string | undefined {
  if (!template.includes('{query}')) return '搜索模板必须包含 {query} 占位符。';
  if (template.length > 2048) return '搜索模板不能超过 2048 个字符。';
  if (!parseSafeHttpUrl(template.replaceAll('{query}', 'test'))) return '模板必须是安全的 HTTP/HTTPS 地址，且不能包含凭据。';

  // `{query}` in the authority (host/userinfo/port) cannot encode a real query.
  //
  // Substituting with 'test' passes validation, but a real query is
  // percent-encoded first: `https://{query}.example.com/` becomes
  // `https://hello%20world.example.com/`, whose host contains a space — not a
  // legal URL, so navigation failed silently with no message. A query belongs in
  // the path or the search params, never in the host.
  const afterScheme = template.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
  const templateAuthority = afterScheme.split(/[/?#]/, 1)[0] ?? '';
  if (templateAuthority.includes('{query}')) return '查询占位符不能出现在域名或端口位置，请放在路径或查询参数中。';
  return undefined;
}

/**
 * Real URL schemes look like `scheme:rest`. `host:port` looks identical.
 *
 * `localhost:3000` and `example.com:8080` both match `^[a-z][a-z\d+.-]*:` — the
 * part before the colon reads as a scheme. The old guard treated them as
 * dangerous protocols and refused, which made the port support below
 * unreachable. The discriminator is the port: a real scheme is not followed by
 * digits only, while `host:port` is.
 */
const SCHEME_CANDIDATE = /^[a-z][a-z\d+.-]*:/i;
const HOST_PORT_CANDIDATE = /^\S+:\d+(?:[/?#].*)?$/;

function hasDangerousScheme(query: string): boolean {
  if (!SCHEME_CANDIDATE.test(query)) return false;
  if (/^https?:\/\//i.test(query)) return false;
  // `host:8080` is not a protocol; let the navigation branch decide.
  if (HOST_PORT_CANDIDATE.test(query)) return false;
  return true;
}

export function resolveSearchDestination(input: string, settings: Pick<WorkspaceSettings, 'searchEngine' | 'customSearchTemplate'>): SearchResult {
  const query = input.trim();
  if (!query) return { ok: false, message: '输入关键词或网址，开始探索。' };
  if (hasDangerousScheme(query)) {
    return { ok: false, message: '仅支持安全的 HTTP/HTTPS 网址，不能打开此协议。' };
  }

  if (/^https?:\/\//i.test(query)) {
    const url = parseSafeHttpUrl(query);
    return url ? { ok: true, url: url.href, kind: 'url' } : { ok: false, message: '网址不安全或格式不完整。' };
  }

  if (!/\s/.test(query) && (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(query) || /^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(query))) {
    const url = parseSafeHttpUrl(`https://${query}`);
    if (url) return { ok: true, url: url.href, kind: 'url' };
  }

  const template = settings.searchEngine === 'custom'
    ? settings.customSearchTemplate
    : SEARCH_ENGINES[settings.searchEngine].template;
  const templateError = validateSearchTemplate(template);
  if (templateError) return { ok: false, message: templateError };
  const url = template.replaceAll('{query}', encodeURIComponent(query));
  // Re-validate the substituted result: a template that passes with the safe
  // literal 'test' can still produce an unusable URL for a real query.
  if (!parseSafeHttpUrl(url)) return { ok: false, message: '搜索地址无效，请检查自定义模板。' };
  return { ok: true, url, kind: 'search' };
}

export function openSafeUrl(url: string, target: 'current' | 'new'): boolean {
  const safe = parseSafeHttpUrl(url);
  if (!safe) return false;
  if (target === 'current') {
    window.location.assign(safe.href);
  } else {
    const opened = window.open(safe.href, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
  }
  return true;
}
