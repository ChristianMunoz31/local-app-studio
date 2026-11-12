import { describe, expect, it } from 'vitest';
import crewRoster from '../fixtures/crew-roster.json';
import { LayerGridSchema, LayoutLayerSchema, validateAppSpec } from '../schema';

const layerWith = (grid: unknown): unknown => ({ id: 'a', type: 'Text', props: {}, children: 'x', grid });

describe('LayoutLayerSchema grid block', () => {
  it('accepts a block', () => {
    const r = LayoutLayerSchema.safeParse(layerWith({ col: 4, span: 3, row: 2, rowSpan: 1 }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.grid).toEqual({ col: 4, span: 3, row: 2, rowSpan: 1 });
  });

  it('refuses an unknown key', () => {
    const r = LayoutLayerSchema.safeParse(layerWith({ col: 1, span: 1, row: 1, rowSpan: 1, extra: 1 }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].code).toBe('unrecognized_keys');
  });

  it('refuses a missing key, fractions and out of range', () => {
    expect(LayerGridSchema.safeParse({ col: 1, span: 1, row: 1 }).success).toBe(false);
    expect(LayerGridSchema.safeParse({ col: 1.5, span: 1, row: 1, rowSpan: 1 }).success).toBe(false);
    expect(LayerGridSchema.safeParse({ col: 13, span: 1, row: 1, rowSpan: 1 }).success).toBe(false);
    expect(LayerGridSchema.safeParse({ col: 1, span: 1, row: 61, rowSpan: 1 }).success).toBe(false);
  });

  it('words the two edge rules at span and rowSpan', () => {
    const wide = LayerGridSchema.safeParse({ col: 10, span: 4, row: 1, rowSpan: 1 });
    expect(wide.success).toBe(false);
    if (!wide.success) {
      expect(wide.error.issues[0].code).toBe('custom');
      expect(wide.error.issues[0].path).toEqual(['span']);
      expect(wide.error.issues[0].message).toBe('A part on the grid must end by column 12. Make it narrower or move it left.');
    }
    const tall = LayerGridSchema.safeParse({ col: 1, span: 1, row: 55, rowSpan: 12 });
    expect(tall.success).toBe(false);
    if (!tall.success) {
      expect(tall.error.issues[0].code).toBe('custom');
      expect(tall.error.issues[0].path).toEqual(['rowSpan']);
      expect(tall.error.issues[0].message).toBe('A part on the grid must end by row 60. Make it shorter or move it up.');
    }
  });

  it('reports at the layer path inside a spec', () => {
    const spec = structuredClone(crewRoster) as unknown as { pages: Array<{ layout: { children: unknown[] } }> };
    spec.pages[0].layout.children = [layerWith({ col: 10, span: 4, row: 1, rowSpan: 1 })];
    const r = validateAppSpec(spec);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('children.0.grid.span') && i.code === 'custom')).toBe(true);
  });

  it('a spec without blocks parses to the same JSON as before', () => {
    const r = validateAppSpec(structuredClone(crewRoster));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.value)).not.toContain('"grid"');
    const again = validateAppSpec(structuredClone(r.value));
    expect(JSON.stringify(again.value)).toBe(JSON.stringify(r.value));
  });
});
