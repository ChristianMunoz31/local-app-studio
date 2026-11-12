// Small color helpers for the theme engine. Pure and deterministic; no imports.

export type Rgb = readonly [number, number, number];

const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));

/** Alphas the engine may emit. Every rgba() value takes its alpha from here (two decimals). */
export const ALPHAS = [0, 0.04, 0.05, 0.08, 0.1, 0.11, 0.16, 0.2, 0.3, 0.45, 0.6, 0.66, 0.7, 0.75, 0.8, 0.85, 0.86, 0.9, 0.93, 0.94, 0.95, 0.97] as const;
export type Alpha = (typeof ALPHAS)[number];

/** HSL to RGB. `h` in degrees (any number, wrapped), `s` and `l` in 0..1 (clamped). */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((((h % 360) + 360) % 360) / 360) * 6;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = lig - c / 2;
  const sector = Math.floor(hue) % 6;
  const parts: ReadonlyArray<Rgb> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = parts[sector] ?? parts[0]!;
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0..1. */
export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio, 1..21, symmetric. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Alpha-composites `top` (opacity `alpha`) over `bottom`. */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [
    clamp255(top[0] * alpha + bottom[0] * (1 - alpha)),
    clamp255(top[1] * alpha + bottom[1] * (1 - alpha)),
    clamp255(top[2] * alpha + bottom[2] * (1 - alpha)),
  ];
}

/**
 * The HSL lightness at which hsl(h, s, L) has the given relative luminance. Bisection with 24 steps over 0..1, so the
 * result is deterministic. Luminance rises with lightness for every hue, so the search is well defined; the result is
 * within 0.005 of the target (the 8-bit rounding of rgb limits the exactness).
 */
export function solveLightness(h: number, s: number, targetLum: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToRgb(h, s, mid)) < targetLum) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** "r g b": the space separated form the kit's rgb(var(--x) / alpha) utilities read. */
export function triplet(rgb: Rgb): string {
  return `${clamp255(rgb[0])} ${clamp255(rgb[1])} ${clamp255(rgb[2])}`;
}

/** "rgb(r, g, b)" with channels clamped to whole numbers 0..255. */
export function rgbString(rgb: Rgb): string {
  return `rgb(${clamp255(rgb[0])}, ${clamp255(rgb[1])}, ${clamp255(rgb[2])})`;
}

/** "rgba(r, g, b, a)"; the alpha comes from the constant table, never from the caller's arithmetic. */
export function rgba(rgb: Rgb, a: Alpha): string {
  return `rgba(${clamp255(rgb[0])}, ${clamp255(rgb[1])}, ${clamp255(rgb[2])}, ${a.toFixed(2)})`;
}
