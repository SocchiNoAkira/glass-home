import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';

/**
 * Widget environment handed down from the host (baseline 10.6 "环境信息":
 * theme, language, size, reduced motion, material quality — read-only).
 *
 * Built-in widgets read this through React context; sandbox widgets receive the
 * same shape over the message protocol in stage 3-C. One definition keeps the
 * two transports from drifting apart.
 */
export interface WidgetEnvironment {
  readonly theme: 'light' | 'dark';
  readonly language: string;
  readonly reducedMotion: boolean;
  readonly materialQuality: 'high' | 'balanced' | 'low' | 'off';
  /** Grid size of this instance, so a widget can pick a compact layout. */
  readonly size: { readonly w: number; readonly h: number };
}

export function widgetEnvironmentKey(environment: WidgetEnvironment): string {
  return `${environment.theme}|${environment.language}|${Number(environment.reducedMotion)}|${environment.materialQuality}|${environment.size.w}x${environment.size.h}`;
}

/**
 * Reads the environment from the rendered app root rather than from a global,
 * so a widget renders correctly even if the app root has not mounted yet.
 */
export function environmentFromRoot(root: HTMLElement): WidgetEnvironment {
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  const material = root.dataset.material;
  return {
    theme,
    language: document.documentElement.lang || 'zh-CN',
    reducedMotion: root.classList.contains('reduced-motion'),
    materialQuality: material === 'high' || material === 'balanced' || material === 'low' || material === 'off' ? material : 'balanced',
    size: { w: 2, h: 2 },
  };
}

/** Environment for a specific grid instance, with its own size filled in. */
export function environmentForItem(root: HTMLElement, item: Pick<LayoutItem, 'w' | 'h'>): WidgetEnvironment {
  return { ...environmentFromRoot(root), size: { w: item.w, h: item.h } };
}

/** Sandbox payload shape; validated before crossing the iframe boundary. */
export function isWidgetEnvironment(value: unknown): value is WidgetEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const size = candidate.size;
  return (
    (candidate.theme === 'light' || candidate.theme === 'dark') &&
    typeof candidate.language === 'string' &&
    candidate.language.length > 0 &&
    candidate.language.length <= 32 &&
    typeof candidate.reducedMotion === 'boolean' &&
    ['high', 'balanced', 'low', 'off'].includes(String(candidate.materialQuality)) &&
    typeof size === 'object' && size !== null &&
    Number.isInteger((size as Record<string, unknown>).w) &&
    Number.isInteger((size as Record<string, unknown>).h) &&
    ((size as Record<string, unknown>).w as number) >= 1 &&
    ((size as Record<string, unknown>).h as number) >= 1
  );
}

export type GridColumnsForWidget = GridColumns;
