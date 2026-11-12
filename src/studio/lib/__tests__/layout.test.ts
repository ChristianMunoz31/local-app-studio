import { describe, expect, it } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { insertionParent, insertionTarget, layerIds, outermostBlock, pathTo, toLayoutLayer } from '../layout';

const node = (id: string, type: string, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props: {}, children });
const marker = { id: 'kpi_row', version: 1, params: { source: 'open_crews' } };

const tree = (): LayoutLayer => {
  const block = { ...node('blk', 'Section', [node('blk-1', 'StatCard')]), name: 'Number row', feature: marker } as LayoutLayer;
  return node('root', 'Page', [node('sec', 'Section', [node('h', 'Heading')]), block, node('tabs', 'Tabs', [node('tab', 'Tab')])]);
};

describe('toLayoutLayer', () => {
  it('copies the feature marker and the name, deep', () => {
    const out = toLayoutLayer(tree());
    const blk = (out.children as { id: string; name?: string; feature?: unknown }[]).find((c) => c.id === 'blk');
    expect(blk?.name).toBe('Number row');
    expect(blk?.feature).toEqual(marker);
    expect(blk?.feature).not.toBe(marker);
  });

  it('leaves layers without a marker without the key', () => {
    const out = toLayoutLayer(node('a', 'Heading', 'Hi'));
    expect('feature' in out).toBe(false);
    expect('sizing' in out).toBe(false);
  });

  it('keeps the sizing block, deep and as a copy', () => {
    const sizing = { width: 'half' as const, grow: true };
    const out = toLayoutLayer(node('root', 'Page', [{ ...node('s', 'StatCard'), sizing }]));
    const copy = (out.children as LayoutLayer[])[0].sizing;
    expect(copy).toEqual({ width: 'half', grow: true });
    expect(copy).not.toBe(sizing);
    expect(JSON.stringify((out.children as LayoutLayer[])[0])).toBe('{"id":"s","type":"StatCard","props":{},"children":[],"sizing":{"width":"half","grow":true}}');
  });
});

describe('tree helpers', () => {
  it('finds paths and ids', () => {
    expect(pathTo(tree(), 'h')?.map((l) => l.id)).toEqual(['root', 'sec', 'h']);
    expect(pathTo(tree(), 'nope')).toBeNull();
    expect(layerIds(tree()).has('blk-1')).toBe(true);
  });

  it('finds the outermost block from the block or from inside it', () => {
    const root = tree();
    expect(outermostBlock(root, 'blk')?.index).toBe(1);
    expect(outermostBlock(root, 'blk-1')?.layer.id).toBe('blk');
    expect(outermostBlock(root, 'h')).toBeNull();
  });
});

describe('insertionParent', () => {
  it('uses the selected section, else its parent, else the page', () => {
    const root = tree();
    expect(insertionParent(root, 'sec', 'DataTable')).toBe('sec');
    expect(insertionParent(root, 'h', 'DataTable')).toBe('sec');
    expect(insertionParent(root, null, 'DataTable')).toBe('root');
  });

  it('never picks a feature block or anything inside one', () => {
    const root = tree();
    expect(insertionParent(root, 'blk', 'DataTable')).toBe('root');
    expect(insertionParent(root, 'blk-1', 'DataTable')).toBe('root');
  });

  it('adds at the end of a selected container and after a selected part otherwise', () => {
    const root = tree();
    expect(insertionTarget(root, 'sec', 'Text')).toEqual({ parentId: 'sec', index: 1 });
    expect(insertionTarget(root, 'h', 'Text')).toEqual({ parentId: 'sec', index: 1 });
    expect(insertionTarget(root, 'blk', 'Text')).toEqual({ parentId: 'root', index: 2 });
    expect(insertionTarget(root, null, 'Text')).toEqual({ parentId: 'root', index: 3 });
  });

  it('respects allowedChildren and childOf', () => {
    const root = tree();
    expect(insertionParent(root, 'tabs', 'Section')).toBe('root');
    expect(insertionParent(root, 'sec', 'Tab')).toBeNull();
    expect(insertionParent(root, 'sec', 'Page')).toBeNull();
  });
});
