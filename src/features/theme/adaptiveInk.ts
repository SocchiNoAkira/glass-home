import { useEffect, useState } from 'react';
import type { WallpaperGradient } from '@/src/domain/workspace/model';

/**
 * Text contrast for arbitrary wallpapers.
 *
 * The extension has no screenshot permission, so it estimates the backdrop
 * locally: the custom wallpaper is drawn into a small offscreen canvas, and
 * every marked text region samples the pixels beneath itself. Built-in
 * gradients are drawn with their CSS colours as a fallback. Glass layers are
 * composited on top of that sample before a near-white or near-black ink is
 * chosen, which keeps the text readable without adding another surface.
 */

type InkMode = 'light' | 'dark';

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Rgba extends Rgb {
  readonly a: number;
}

type RectLike = Readonly<{ left: number; top: number; width: number; height: number }>;
type WallpaperSampler = (rect: RectLike) => Rgb;

const SAMPLE_SIZE = 96;
const SAMPLE_GRID = 5;

const LIGHT_INK: Rgb = { r: 255, g: 250, b: 247 };
const DARK_INK: Rgb = { r: 27, g: 22, b: 32 };
const MODAL_BACKDROP: Rgba = { r: 30, g: 25, b: 41, a: 0.31 };

const WALLPAPER_GRADIENTS: Readonly<Record<WallpaperGradient, {
  readonly angle: number;
  readonly stops: readonly (readonly [number, string])[];
}>> = {
  dawn: {
    angle: 120,
    stops: [[0, '#6c637e'], [0.45, '#a28a96'], [1, '#53516c']],
  },
  dusk: {
    angle: 130,
    stops: [[0, '#262f4c'], [0.48, '#66506f'], [1, '#b88083']],
  },
  sage: {
    angle: 130,
    stops: [[0, '#536d6c'], [0.45, '#9cafa3'], [1, '#c6bda7']],
  },
};

export interface AdaptiveInkOptions {
  readonly wallpaperUrl: string | undefined;
  readonly wallpaperGradient: WallpaperGradient;
  readonly theme: 'light' | 'dark';
  readonly overlay: number;
  /** Re-runs measurement after a workspace/layout change. */
  readonly revision: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseRgba(input: string): Rgba | undefined {
  const value = input.trim();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const channels = [...hex].map((part) => Number.parseInt(part.repeat(2), 16));
      return {
        r: channels[0] ?? 0,
        g: channels[1] ?? 0,
        b: channels[2] ?? 0,
        a: channels[3] === undefined ? 1 : (channels[3] ?? 255) / 255,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return undefined;
  }

  const match = value.match(
    /^rgba?\(\s*([+-]?\d*\.?\d+)\s*[,\s]\s*([+-]?\d*\.?\d+)\s*[,\s]\s*([+-]?\d*\.?\d+)(?:\s*[,/]\s*([+-]?\d*\.?\d+)(%)?)?\s*\)$/i,
  );
  if (!match) return undefined;

  const alphaText = match[4];
  const alpha = alphaText === undefined
    ? 1
    : (Number.parseFloat(alphaText) / (match[5] ? 100 : 1));
  return {
    r: clamp(Number.parseFloat(match[1] ?? '0'), 0, 255),
    g: clamp(Number.parseFloat(match[2] ?? '0'), 0, 255),
    b: clamp(Number.parseFloat(match[3] ?? '0'), 0, 255),
    a: clamp(alpha, 0, 1),
  };
}

function blend(foreground: Rgba, background: Rgb): Rgb {
  const alpha = clamp(foreground.a, 0, 1);
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  };
}

function luminance({ r, g, b }: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function chooseInk(background: Rgb, theme: 'light' | 'dark', customWallpaper: boolean): InkMode {
  const preferred: InkMode = theme === 'dark' ? 'light' : 'dark';
  const alternative: InkMode = theme === 'dark' ? 'dark' : 'light';
  const preferredContrast = contrast(preferred === 'light' ? LIGHT_INK : DARK_INK, background);
  const alternativeContrast = contrast(alternative === 'light' ? LIGHT_INK : DARK_INK, background);
  // A user's photo has no designed palette, so take the best contrast. The
  // generated gradients already follow the theme; only invert those when the
  // difference is clear enough to avoid needless flipping.
  if (customWallpaper) return alternativeContrast > preferredContrast ? alternative : preferred;
  return alternativeContrast > preferredContrast * 1.08 ? alternative : preferred;
}

function samplePixels(data: Uint8ClampedArray, rect: RectLike, viewportWidth: number, viewportHeight: number): Rgb {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const left = clamp(rect.left / width, 0, 1);
  const right = clamp((rect.left + rect.width) / width, 0, 1);
  const top = clamp(rect.top / height, 0, 1);
  const bottom = clamp((rect.top + rect.height) / height, 0, 1);

  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let row = 0; row < SAMPLE_GRID; row += 1) {
    const y = Math.round((top + (bottom - top) * (row / (SAMPLE_GRID - 1))) * (SAMPLE_SIZE - 1));
    for (let column = 0; column < SAMPLE_GRID; column += 1) {
      const x = Math.round((left + (right - left) * (column / (SAMPLE_GRID - 1))) * (SAMPLE_SIZE - 1));
      const offset = (y * SAMPLE_SIZE + x) * 4;
      red += data[offset] ?? 0;
      green += data[offset + 1] ?? 0;
      blue += data[offset + 2] ?? 0;
      count += 1;
    }
  }

  return { r: red / count, g: green / count, b: blue / count };
}

function createGradientSampler(gradient: WallpaperGradient, theme: 'light' | 'dark'): WallpaperSampler {
  const specification = WALLPAPER_GRADIENTS[gradient];
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return () => ({ r: 110, g: 100, b: 120 });

  const radians = (specification.angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(SAMPLE_SIZE * dx) + Math.abs(SAMPLE_SIZE * dy);
  const center = SAMPLE_SIZE / 2;
  const fill = context.createLinearGradient(
    center - (dx * length) / 2,
    center - (dy * length) / 2,
    center + (dx * length) / 2,
    center + (dy * length) / 2,
  );
  for (const [offset, color] of specification.stops) fill.addColorStop(offset, color);
  context.fillStyle = fill;
  context.fillRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  const image = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  if (theme === 'light') {
    // Matches the light-theme brightness filter on the generated wallpapers.
    for (let index = 0; index < image.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const position = index + channel;
        image.data[position] = clamp((image.data[position] ?? 0) * 1.15, 0, 255);
      }
    }
  }

  return (rect) => samplePixels(image.data, rect, window.innerWidth, window.innerHeight);
}

function loadWallpaper(url: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

function createImageSampler(image: HTMLImageElement): WallpaperSampler {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return () => ({ r: 110, g: 100, b: 120 });

  let pixels: Uint8ClampedArray | undefined;
  let viewportKey = '';

  const draw = () => {
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const viewportAspect = viewportWidth / viewportHeight;
    const imageAspect = image.naturalWidth / image.naturalHeight;

    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    // The wallpaper uses `background-size: cover`, so only the centre crop is
    // ever visible. Sampling that crop is what keeps the estimate local.
    if (imageAspect > viewportAspect) {
      sourceWidth = sourceHeight * viewportAspect;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = sourceWidth / viewportAspect;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    viewportKey = `${viewportWidth}x${viewportHeight}`;
  };

  return (rect) => {
    const key = `${window.innerWidth}x${window.innerHeight}`;
    if (!pixels || key !== viewportKey) draw();
    return samplePixels(pixels ?? new Uint8ClampedArray(SAMPLE_SIZE * SAMPLE_SIZE * 4), rect, window.innerWidth, window.innerHeight);
  };
}

function overlayColour(theme: 'light' | 'dark'): Rgb {
  return theme === 'light' ? { r: 255, g: 246, b: 238 } : { r: 33, g: 28, b: 51 };
}

function effectiveBackdrop(
  target: HTMLElement,
  sampleWallpaper: WallpaperSampler,
  theme: 'light' | 'dark',
  overlay: number,
): Rgb {
  let background = sampleWallpaper(target.getBoundingClientRect());
  background = blend({ ...overlayColour(theme), a: clamp(overlay / 100, 0, 1) }, background);

  // The dialog backdrop dims the page before the strong modal surface is drawn.
  if (target instanceof HTMLDialogElement) background = blend(MODAL_BACKDROP, background);

  const layers: Rgba[] = [];
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node.classList.contains('app')) break;
    const colour = parseRgba(getComputedStyle(node).backgroundColor);
    if (colour && colour.a > 0) layers.push(colour);
  }
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer) background = blend(layer, background);
  }
  return background;
}

function applyInk(sampleWallpaper: WallpaperSampler, theme: 'light' | 'dark', overlay: number, customWallpaper: boolean): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-adaptive-ink]');
  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const mode = chooseInk(effectiveBackdrop(target, sampleWallpaper, theme, overlay), theme, customWallpaper);
    if (target.dataset.ink !== mode) target.dataset.ink = mode;
  }
}

/**
 * Marks the regions whose text should follow the wallpaper.
 *
 * The hook observes the DOM because dialogs and widget menus appear after the
 * home screen is already rendered; it re-measures on layout changes, resizes
 * and custom-wallpaper loads. It never writes colours inline: CSS owns the
 * two palettes, so contrast can be adjusted in one place.
 */
export function useAdaptiveInk({ wallpaperUrl, wallpaperGradient, theme, overlay, revision }: AdaptiveInkOptions): void {
  const [sampler, setSampler] = useState<WallpaperSampler>();

  useEffect(() => {
    let cancelled = false;
    setSampler(() => createGradientSampler(wallpaperGradient, theme));
    if (!wallpaperUrl) return () => { cancelled = true; };

    void loadWallpaper(wallpaperUrl).then((image) => {
      if (cancelled || !image) return;
      try {
        const imageSampler = createImageSampler(image);
        setSampler(() => imageSampler);
      } catch {
        // Keep the gradient estimate if the blob cannot be read.
      }
    });
    return () => { cancelled = true; };
  }, [theme, wallpaperGradient, wallpaperUrl]);

  useEffect(() => {
    if (!sampler) return;
    let disposed = false;
    let frame = 0;

    const paint = () => {
      frame = 0;
      if (!disposed) applyInk(sampler, theme, overlay, Boolean(wallpaperUrl));
    };
    const schedule = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(paint);
    };

    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    const delayed = window.setTimeout(schedule, 0);
    void document.fonts.ready.then(schedule).catch(() => undefined);

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
    };
  }, [overlay, revision, sampler, theme, wallpaperUrl]);
}
