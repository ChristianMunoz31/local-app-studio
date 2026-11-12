import { describe, expect, it } from 'vitest';
import { contrast, hslToRgb, luminance, rgba, solveLightness, triplet } from '../color.ts';

describe('color helpers', () => {
  it('converts known HSL values to RGB', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
    expect(hslToRgb(0, 0, 1)).toEqual([255, 255, 255]);
    expect(hslToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    expect(hslToRgb(360, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(-120, 1, 0.5)).toEqual([0, 0, 255]);
  });

  it('computes WCAG luminance and contrast', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([0, 0, 0])).toBe(0);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });

  it('keeps the kit pairs as documented in src/index.css', () => {
    // dark: slate-400 on a warm charcoal glass is above 4.5, light: gray-500 on white is 4.7
    expect(contrast([171, 158, 140], [44, 38, 32])).toBeGreaterThan(4.5);
    expect(contrast([107, 114, 128], [255, 255, 255])).toBeGreaterThan(4.5);
  });

  it('solves a lightness for a target luminance within 0.005 for every hue and chroma level', () => {
    for (const s of [0, 0.45, 0.75]) {
      for (let hue = 0; hue <= 359; hue += 1) {
        for (const target of [0.075, 0.13, 0.45]) {
          const got = luminance(hslToRgb(hue, s, solveLightness(hue, s, target)));
          expect(Math.abs(got - target)).toBeLessThan(0.005);
        }
      }
    }
  });

  it('is deterministic', () => {
    expect(solveLightness(200, 0.75, 0.13)).toBe(solveLightness(200, 0.75, 0.13));
  });

  it('formats triplets and rgba values with clamped whole numbers and two decimals', () => {
    expect(triplet([1.4, 300, -5])).toBe('1 255 0');
    expect(rgba([1, 2, 3], 0.66)).toBe('rgba(1, 2, 3, 0.66)');
    expect(rgba([1, 2, 3], 0.2)).toBe('rgba(1, 2, 3, 0.20)');
  });
});
