/* global process */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Status chips (src/components/settings/pillStyles.js TONE_CLASS.ok) are the accent text colour on
// a 15% tint of itself over the card. WCAG AA for normal text needs 4.5:1 against the worst backdrop,
// and every background preset is checked, so adding a preset with a bright blob fails here first.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

// Every top-level `<selector> {` block (a selector can appear more than once in the stylesheet).
const blocks = (selector) => {
  const out = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(`\n${selector} {`, from);
    if (start === -1) return out;
    const end = css.indexOf('\n}', start);
    out.push(css.slice(start, end));
    from = end;
  }
};
const token = (selector, name) => {
  for (const text of blocks(selector)) {
    const m = new RegExp(`${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(text);
    if (m) return m.slice(1).map(Number);
  }
  throw new Error(`${name} not found in ${selector}`);
};
const over = (top, alpha, bottom) => top.map((c, i) => c * alpha + bottom[i] * (1 - alpha));
const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Every preset's mesh blobs, read from index.css (--mesh-<preset>-<theme>-<n>: rgba(r, g, b, a)).
const meshBlobs = (theme) =>
  [...css.matchAll(new RegExp(`--mesh-([a-z]+)-${theme}-\\d:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`, 'g'))].map((m) => ({
    preset: m[1],
    rgb: [Number(m[2]), Number(m[3]), Number(m[4])],
    alpha: Number(m[5]),
  }));

describe('"Ollama is running" chip contrast', () => {
  it('reads every preset blob from the stylesheet (the guard is not vacuous)', () => {
    expect(meshBlobs('light').length).toBeGreaterThanOrEqual(15);
    expect(meshBlobs('dark').length).toBeGreaterThanOrEqual(15);
    expect(new Set(meshBlobs('dark').map((b) => b.preset)).size).toBeGreaterThanOrEqual(5);
  });

  it('is at least 4.5:1 in the light theme on every preset backdrop', () => {
    const text = token(':root.light', '--acc-green');
    for (const blob of meshBlobs('light')) {
      // Page #f3f4f6 under the blob, then the 0.8 white glass card, then the 15% chip tint.
      const page = over(blob.rgb, blob.alpha, [243, 244, 246]);
      const card = over([255, 255, 255], 0.8, page);
      expect(ratio(text, over(text, 0.15, card)), blob.preset).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is at least 4.5:1 in the dark theme on every preset backdrop', () => {
    const text = token(':root', '--acc-green');
    for (const blob of meshBlobs('dark')) {
      const page = over(blob.rgb, blob.alpha, [20, 17, 14]);
      const card = over([52, 45, 38], 0.66, page);
      expect(ratio(text, over(text, 0.15, card)), blob.preset).toBeGreaterThanOrEqual(4.5);
    }
  });
});
