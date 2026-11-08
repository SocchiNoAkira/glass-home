import { parseSafeHttpUrl } from '@/src/domain/search/search';

export const SHORTCUT_COLORS = ['#7775e9', '#7bb9ac', '#db9570', '#70a6e8', '#e774a5', '#f2c36b', '#e7e8ed'] as const;

export function validateShortcut(title: string, url: string): string | undefined {
  if (!title.trim() || title.trim().length > 40) return '名称需要为 1～40 个字符。';
  if (url.length > 2048 || !parseSafeHttpUrl(url.trim())) return '请输入有效的 HTTP/HTTPS 地址，不能包含用户名或密码。';
  return undefined;
}

export function fallbackIcon(title: string): string {
  const first = title.trim().charAt(0);
  return first ? first.toLocaleUpperCase() : '↗';
}
