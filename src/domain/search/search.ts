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
  return undefined;
}

export function resolveSearchDestination(input: string, settings: Pick<WorkspaceSettings, 'searchEngine' | 'customSearchTemplate'>): SearchResult {
  const query = input.trim();
  if (!query) return { ok: false, message: '输入关键词或网址，开始探索。' };
  if (/^[a-z][a-z\d+.-]*:/i.test(query) && !/^https?:\/\//i.test(query)) {
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
  return { ok: true, url: template.replaceAll('{query}', encodeURIComponent(query)), kind: 'search' };
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
