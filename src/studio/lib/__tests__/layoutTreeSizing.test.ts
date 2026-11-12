// Widths in the pure tree helpers (DESIGN-phase9.md 5.1 to 5.3): side targets and drops, setSizing, the resize handle and its
// pair table, Shrink and Widen, and placement kept by replaceLayer.
import { describe, expect, it } from 'vitest';
import { layer } from '@/catalog/__tests__/fixtures';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { LayerWidth } from '@local-app-studio/runtime/spec/sizing';
import {
  besideSizing,
  canSize,
  findLayer,
  handleCandidates,
  insertBeside,
  moveBeside,
  moveBy,
  moveLayer,
  pairCandidates,
  removeLayer,
  replaceLayer,
  resizeHandles,
  resizePair,
  setSizing,
  sideTargets,
  stepWidth,
} from '../layoutTree';
import type { TreeRefusal, TreeResult } from '../layoutTree';

const marker = { id: 'kpi_row', version: 1, params: { source: 'open_crews' } };
const text = (id: string, width?: LayerWidth, grow = false): LayoutLayer => ({ ...layer(id, 'Text', {}, id), ...(width === undefined ? {} : { sizing: { width, grow } }) });

/** root > a, b(half), c(half), sec(s1, s2), grid(g1), row(r1), tabs(tab1(x1)), cols(col1(y1), col2), blk (block: k1), hd(page header). */
const tree = (): LayoutLayer =>
  layer('root', 'Page', {}, [
    text('a'),
    text('b', 'half'),
    text('c', 'half'),
    layer('sec', 'Section', { title: 'S' }, [text('s1'), text('s2', 'third')]),
    layer('grid', 'Grid', { columns: 2 }, [text('g1')]),
    layer('row', 'Row', {}, [text('r1')]),
    layer('tabs', 'Tabs', {}, [layer('tab1', 'Tab', { label: 'One' }, [text('x1')])]),
    layer('cols', 'Columns', {}, [layer('col1', 'Column', {}, [text('y1')]), layer('col2', 'Column', {}, [])]),
    { ...layer('blk', 'Section', {}, [text('k1')]), name: 'Number row', feature: marker },
  ]);

const must = (r: TreeResult): LayoutLayer => {
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.message}`);
  return r.root;
};
const reason = (r: TreeResult): TreeRefusal | 'ok' => (r.ok ? 'ok' : r.reason);
const message = (r: TreeResult): string => (r.ok ? '' : r.message);
const get = (root: LayoutLayer, id: string): LayoutLayer => {
  const found = findLayer(root, id);
  if (found === null) throw new Error(`no ${id}`);
  return found.layer;
};
const sizing = (root: LayoutLayer, id: string): LayoutLayer['sizing'] => get(root, id).sizing;
const childIds = (root: LayoutLayer, id: string): string[] => {
  const kids = get(root, id).children;
  return Array.isArray(kids) ? kids.map((k) => k.id) : [];
};
const pagePair = (l: LayerWidth, r: LayerWidth, more: LayoutLayer[] = []): LayoutLayer => layer('root', 'Page', {}, [text('l', l), text('r', r), ...more]);

describe('sideTargets', () => {
  it('offers both sides of every layer in a stacking parent, in document order', () => {
    const keys = sideTargets(tree(), 'Text').map((t) => `${t.targetId}:${t.side}`);
    expect(keys.slice(0, 6)).toEqual(['a:left', 'a:right', 'b:left', 'b:right', 'c:left', 'c:right']);
    expect(keys).toContain('sec:left');
    expect(keys).toContain('s2:right');
    expect(keys).toContain('x1:left');
    expect(keys).toContain('y1:right');
    // Both sides of a block root, nothing inside it.
    expect(keys).toContain('blk:left');
    expect(keys).toContain('blk:right');
    expect(keys.some((k) => k.startsWith('k1:'))).toBe(false);
  });

  it('offers nothing under Grid, Row, Tabs, Columns or a page header, and nothing on a Tab, a Column or the root', () => {
    const header = layer('root', 'Page', {}, [layer('hd', 'PageHeader', { title: 'T' }, [layer('b1', 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go')])]);
    const ids = new Set([...sideTargets(tree(), 'Text'), ...sideTargets(header, 'Button')].map((t) => t.targetId));
    for (const id of ['g1', 'r1', 'tab1', 'col1', 'col2', 'root', 'b1']) expect(ids.has(id), id).toBe(false);
    expect(ids.has('grid')).toBe(true);
    expect(ids.has('hd')).toBe(true);
  });

  it('offers nothing for a Tab, a Column or a Page, and follows what the parent can hold', () => {
    expect(sideTargets(tree(), 'Tab')).toEqual([]);
    expect(sideTargets(tree(), 'Column')).toEqual([]);
    expect(sideTargets(tree(), 'Page')).toEqual([]);
    expect(sideTargets(tree(), 'Text', 'col1')).toEqual([]);
    expect(sideTargets(tree(), 'Button').map((t) => t.targetId)).toContain('a');
  });

  it('leaves out the moving layer, its subtree and every place when the layer is the root or inside a block', () => {
    const ids = sideTargets(tree(), 'Section', 'sec').map((t) => t.targetId);
    expect(ids).not.toContain('sec');
    expect(ids).not.toContain('s1');
    expect(ids).toContain('a');
    expect(sideTargets(tree(), 'Text', 'k1')).toEqual([]);
    expect(sideTargets(tree(), 'Page', 'root')).toEqual([]);
    expect(sideTargets(tree(), 'Text', 'missing')).toEqual([]);
  });

  it('keeps the child count rules of dropTargets (a page header may lose a button, so its buttons can go beside others)', () => {
    const button = (id: string): LayoutLayer => layer(id, 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go');
    const full = layer('root', 'Page', {}, [layer('c', 'Card', {}, [button('b1')]), layer('hd', 'PageHeader', { title: 'T' }, [button('b2'), button('b3'), button('b4')])]);
    expect(sideTargets(full, 'Button', 'b2').map((t) => t.targetId)).toContain('b1');
  });
});

describe('besideSizing', () => {
  it('turns a whole-row target and the dropped part into halves, else gives the part the target width', () => {
    expect(besideSizing({ width: 'full', grow: false })).toEqual({ target: { width: 'half', grow: false }, dropped: { width: 'half', grow: false } });
    expect(besideSizing({ width: 'third', grow: true })).toEqual({ target: null, dropped: { width: 'third', grow: false } });
    expect(besideSizing({ width: 'fit', grow: false })).toEqual({ target: null, dropped: { width: 'fit', grow: false } });
  });
});

describe('insertBeside and moveBeside', () => {
  it('inserts beside a whole-row target: both take half, the new layer has the focus', () => {
    const r = insertBeside(tree(), { targetId: 'a', side: 'right' }, text('n'));
    expect(r.ok && r.focusId).toBe('n');
    const root = must(r);
    expect(childIds(root, 'root').slice(0, 3)).toEqual(['a', 'n', 'b']);
    expect(sizing(root, 'a')).toEqual({ width: 'half', grow: false });
    expect(sizing(root, 'n')).toEqual({ width: 'half', grow: false });
  });

  it('inserts on the left beside a third: the new layer takes a third and the target is unchanged', () => {
    const root0 = tree();
    const root = must(insertBeside(root0, { targetId: 's2', side: 'left' }, text('n')));
    expect(childIds(root, 'sec')).toEqual(['s1', 'n', 's2']);
    expect(sizing(root, 'n')).toEqual({ width: 'third', grow: false });
    expect(get(root, 's2')).toBe(get(root0, 's2'));
  });

  it('drops a sizing the new layer brought along (rule of the place)', () => {
    const root = must(insertBeside(tree(), { targetId: 'b', side: 'right' }, text('n', 'quarter', true)));
    expect(sizing(root, 'n')).toEqual({ width: 'half', grow: false });
  });

  it('moves in the same parent, left and right', () => {
    const left = must(moveBeside(tree(), 'c', { targetId: 'b', side: 'left' }));
    expect(childIds(left, 'root').slice(0, 3)).toEqual(['a', 'c', 'b']);
    const right = must(moveBeside(tree(), 'a', { targetId: 'c', side: 'right' }));
    expect(childIds(right, 'root').slice(0, 3)).toEqual(['b', 'c', 'a']);
    expect(sizing(right, 'a')).toEqual({ width: 'half', grow: false });
    expect(sizing(right, 'c')).toEqual({ width: 'half', grow: false });
  });

  it('moves from another parent and leaves the old neighbour alone', () => {
    const root0 = tree();
    const r = moveBeside(root0, 'c', { targetId: 's1', side: 'right' });
    expect(r.ok && r.focusId).toBe('c');
    const root = must(r);
    expect(childIds(root, 'sec')).toEqual(['s1', 'c', 's2']);
    expect(sizing(root, 's1')).toEqual({ width: 'half', grow: false });
    expect(sizing(root, 'c')).toEqual({ width: 'half', grow: false });
    expect(sizing(root, 'b')).toEqual({ width: 'half', grow: false });
    expect(get(root, 'b')).toBe(get(root0, 'b'));
  });

  it('refuses in plain words', () => {
    expect(message(moveBeside(tree(), 'b', { targetId: 'b', side: 'left' }))).toBe('A part cannot go beside itself.');
    expect(reason(insertBeside(tree(), { targetId: 'missing', side: 'left' }, text('n')))).toBe('not_found');
    expect(reason(insertBeside(tree(), { targetId: 'k1', side: 'left' }, text('n')))).toBe('inside_block');
    expect(message(insertBeside(tree(), { targetId: 'g1', side: 'left' }, text('n')))).toBe('Parts in here cannot sit side by side.');
    expect(message(insertBeside(tree(), { targetId: 'tab1', side: 'left' }, text('n')))).toBe('This part takes the width of the part it is in.');
    expect(message(insertBeside(tree(), { targetId: 'a', side: 'left' }, layer('t9', 'Tab', { label: 'T' }, [])))).toBe('This part takes the width of the part it is in.');
    expect(reason(insertBeside(tree(), { targetId: 'a', side: 'up' as 'left' }, text('n')))).toBe('bad_value');
    expect(reason(insertBeside(tree(), { targetId: 'a', side: 'left' }, text('b')))).toBe('bad_value');
    expect(reason(moveBeside(tree(), 'sec', { targetId: 's1', side: 'left' }))).toBe('into_itself');
    expect(reason(moveBeside(tree(), 'root', { targetId: 'a', side: 'left' }))).toBe('root_locked');
  });

  it('never changes its input', () => {
    const root = tree();
    const before = JSON.stringify(root);
    insertBeside(root, { targetId: 'a', side: 'right' }, text('n'));
    moveBeside(root, 'c', { targetId: 's1', side: 'right' });
    expect(JSON.stringify(root)).toBe(before);
  });
});

describe('moves keep every width', () => {
  it('moveLayer, moveBy and removeLayer leave sizing blocks as they were', () => {
    const root0 = tree();
    const out = must(moveLayer(root0, 'b', { parentId: 'sec', index: 0 }));
    expect(sizing(out, 'b')).toEqual({ width: 'half', grow: false });
    expect(sizing(out, 'c')).toEqual({ width: 'half', grow: false });
    expect(sizing(must(moveBy(root0, 'b', -1)), 'b')).toEqual({ width: 'half', grow: false });
    expect(sizing(must(removeLayer(root0, 'b')), 'c')).toEqual({ width: 'half', grow: false });
  });
});

describe('setSizing', () => {
  it('writes width and grow, and Whole row deletes the block', () => {
    const third = must(setSizing(tree(), 'a', { width: 'third', grow: true }));
    expect(sizing(third, 'a')).toEqual({ width: 'third', grow: true });
    const whole = must(setSizing(tree(), 'b', { width: 'full', grow: true }));
    expect(Object.hasOwn(get(whole, 'b'), 'sizing')).toBe(false);
  });

  it('answers the same root when nothing changes', () => {
    const root = tree();
    expect(must(setSizing(root, 'b', { width: 'half', grow: false }))).toBe(root);
    expect(must(setSizing(root, 'a', { width: 'full', grow: false }))).toBe(root);
    expect(must(setSizing(root, 'a', { width: 'full', grow: true }))).toBe(root);
  });

  it('a round trip half then back to the whole row gives the original layer', () => {
    const root = tree();
    const back = must(setSizing(must(setSizing(root, 'a', { width: 'half', grow: false })), 'a', { width: 'full', grow: false }));
    expect(JSON.stringify(back)).toBe(JSON.stringify(root));
  });

  it('refuses a width that is not one of the list, and places without widths', () => {
    expect(message(setSizing(tree(), 'a', { width: 'huge', grow: false }))).toBe('Pick one of the widths.');
    expect(reason(setSizing(tree(), 'a', { width: 'half', grow: 'yes' as unknown as boolean }))).toBe('bad_value');
    expect(reason(setSizing(tree(), 'a', { width: '__proto__', grow: false }))).toBe('bad_value');
    expect(reason(setSizing(tree(), 'root', { width: 'half', grow: false }))).toBe('root_locked');
    expect(reason(setSizing(tree(), 'k1', { width: 'half', grow: false }))).toBe('inside_block');
    expect(reason(setSizing(tree(), 'tab1', { width: 'half', grow: false }))).toBe('no_sizing');
    expect(reason(setSizing(tree(), 'col1', { width: 'half', grow: false }))).toBe('no_sizing');
    expect(message(setSizing(tree(), 'g1', { width: 'half', grow: false }))).toBe('Parts in here cannot sit side by side.');
    expect(reason(setSizing(tree(), 'r1', { width: 'half', grow: false }))).toBe('no_sizing');
    expect(reason(setSizing(tree(), 'missing', { width: 'half', grow: false }))).toBe('not_found');
    expect(reason(setSizing(tree(), 'blk', { width: 'half', grow: false }))).toBe('ok');
  });

  it('canSize matches the refusals', () => {
    for (const id of ['a', 'b', 's1', 'x1', 'y1', 'blk', 'grid', 'sec']) expect(canSize(tree(), id), id).toBe(true);
    for (const id of ['root', 'g1', 'r1', 'tab1', 'col1', 'k1', 'missing']) expect(canSize(tree(), id), id).toBe(false);
  });
});

describe('resizeHandles', () => {
  it('pairs neighbours on one line: half, half, half gives one handle and then a new line', () => {
    const root = layer('root', 'Page', {}, [text('a', 'half'), text('b', 'half'), text('c', 'half')]);
    expect(resizeHandles(root, 'root')).toEqual([{ leftId: 'a', rightId: 'b' }]);
  });

  it('skips fit and growing parts, whole-row parts split runs, and nothing outside stacking parents or inside a block', () => {
    expect(resizeHandles(layer('root', 'Page', {}, [text('a', 'half'), text('b', 'fit'), text('c', 'quarter')]), 'root')).toEqual([]);
    expect(resizeHandles(layer('root', 'Page', {}, [text('a', 'half'), text('b', 'half', true)]), 'root')).toEqual([]);
    expect(resizeHandles(layer('root', 'Page', {}, [text('a', 'half'), text('m'), text('b', 'half')]), 'root')).toEqual([]);
    expect(resizeHandles(tree(), 'root')).toEqual([{ leftId: 'b', rightId: 'c' }]);
    expect(resizeHandles(layer('root', 'Page', {}, [layer('g', 'Grid', {}, [text('a', 'half'), text('b', 'half')])]), 'g')).toEqual([]);
    const block = layer('root', 'Page', {}, [{ ...layer('blk', 'Section', {}, [text('a', 'half'), text('b', 'half')]), feature: marker }]);
    expect(resizeHandles(block, 'blk')).toEqual([]);
    expect(resizeHandles(tree(), 'missing')).toEqual([]);
  });

  it('three thirds give two handles, a quarter and three quarters one', () => {
    expect(resizeHandles(layer('root', 'Page', {}, [text('a', 'third'), text('b', 'third'), text('c', 'third'), text('d', 'quarter'), text('e', 'three-quarters')]), 'root')).toEqual([
      { leftId: 'a', rightId: 'b' },
      { leftId: 'b', rightId: 'c' },
      { leftId: 'd', rightId: 'e' },
    ]);
  });
});

describe('pairCandidates', () => {
  it('walks the pair table both ways from the current position', () => {
    expect(pairCandidates('half', 'half')).toEqual([
      { left: 'quarter', right: 'three-quarters', steps: -2 },
      { left: 'third', right: 'two-thirds', steps: -1 },
      { left: 'half', right: 'half', steps: 0 },
      { left: 'two-thirds', right: 'third', steps: 1 },
      { left: 'three-quarters', right: 'quarter', steps: 2 },
    ]);
    expect(pairCandidates('quarter', 'three-quarters').map((c) => c.steps)).toEqual([0, 1, 2, 3, 4]);
    expect(pairCandidates('three-quarters', 'quarter').map((c) => c.steps)).toEqual([-4, -3, -2, -1, 0]);
  });

  it('steps a pair that does not fill the row on the share ladder', () => {
    expect(pairCandidates('third', 'third')).toEqual([
      { left: 'quarter', right: 'half', steps: -1 },
      { left: 'third', right: 'third', steps: 0 },
      { left: 'half', right: 'quarter', steps: 1 },
    ]);
  });
});

describe('resizePair', () => {
  it('moves the handle by steps and stops at the end', () => {
    const r = resizePair(pagePair('half', 'half'), 'l', 1);
    expect(r.ok && r.focusId).toBe('l');
    const root = must(r);
    expect(sizing(root, 'l')).toEqual({ width: 'two-thirds', grow: false });
    expect(sizing(root, 'r')).toEqual({ width: 'third', grow: false });
    const far = must(resizePair(pagePair('half', 'half'), 'l', 9));
    expect(sizing(far, 'l')).toEqual({ width: 'three-quarters', grow: false });
    expect(sizing(far, 'r')).toEqual({ width: 'quarter', grow: false });
    const back = must(resizePair(pagePair('half', 'half'), 'l', -9));
    expect(sizing(back, 'l')).toEqual({ width: 'quarter', grow: false });
  });

  it('refuses at the end, on a part with no handle on its right, and answers the same root for no step', () => {
    expect(message(resizePair(pagePair('three-quarters', 'quarter'), 'l', 1))).toBe('The handle cannot go further this way.');
    expect(reason(resizePair(pagePair('quarter', 'three-quarters'), 'l', -1))).toBe('at_end');
    expect(message(resizePair(pagePair('half', 'half'), 'r', 1))).toBe('Only two parts side by side in one row can be resized together.');
    expect(reason(resizePair(pagePair('half', 'fit'), 'l', 1))).toBe('not_paired');
    expect(reason(resizePair(pagePair('half', 'half'), 'missing', 1))).toBe('not_found');
    expect(reason(resizePair(pagePair('half', 'half'), 'root', 1))).toBe('root_locked');
    expect(reason(resizePair(pagePair('half', 'half'), 'l', 0.5))).toBe('bad_value');
    const root = pagePair('half', 'half');
    expect(must(resizePair(root, 'l', 0))).toBe(root);
  });

  it('ladder steps for third plus third', () => {
    const root = must(resizePair(pagePair('third', 'third'), 'l', 1));
    expect(sizing(root, 'l')).toEqual({ width: 'half', grow: false });
    expect(sizing(root, 'r')).toEqual({ width: 'quarter', grow: false });
    expect(reason(resizePair(root, 'l', 1))).toBe('at_end');
  });

  it('never pushes the rest of the line to a new line: three thirds keep their line', () => {
    const thirds = layer('root', 'Page', {}, [text('a', 'third'), text('b', 'third'), text('c', 'third')]);
    // Half plus a quarter plus a third, or a quarter plus a half plus a third, is 13 twelfths: the third block would wrap,
    // so the handle cannot move either way.
    expect(handleCandidates(thirds, 'a').map((c) => c.steps)).toEqual([0]);
    expect(message(resizePair(thirds, 'a', 1))).toBe('The handle cannot go further this way.');
    expect(reason(resizePair(thirds, 'a', -1))).toBe('at_end');
    expect(reason(resizePair(thirds, 'b', 1))).toBe('at_end');
  });

  it('a half plus half pair still steps to two-thirds plus a third, also with a part on the next line', () => {
    const root = must(resizePair(pagePair('half', 'half', [text('n', 'half')]), 'l', 1));
    expect([sizing(root, 'l'), sizing(root, 'r'), sizing(root, 'n')]).toEqual([
      { width: 'two-thirds', grow: false },
      { width: 'third', grow: false },
      { width: 'half', grow: false },
    ]);
    expect(handleCandidates(pagePair('half', 'half'), 'l').map((c) => c.steps)).toEqual([-2, -1, 0, 1, 2]);
    expect(handleCandidates(pagePair('half', 'half'), 'r')).toEqual([]);
  });
});

describe('stepWidth', () => {
  it('a part alone steps through fit, quarter, third, half, two-thirds, three-quarters and the whole row', () => {
    const order: Array<LayerWidth> = ['fit', 'quarter', 'third', 'half', 'two-thirds', 'three-quarters', 'full'];
    let root = layer('root', 'Page', {}, [text('a', 'fit')]);
    for (const next of order.slice(1)) {
      root = must(stepWidth(root, 'a', 1));
      if (next === 'full') expect(Object.hasOwn(get(root, 'a'), 'sizing')).toBe(false);
      else expect(sizing(root, 'a')).toEqual({ width: next, grow: false });
    }
    expect(message(stepWidth(root, 'a', 1))).toBe('This already takes the whole row.');
    root = must(stepWidth(root, 'a', -1));
    expect(sizing(root, 'a')).toEqual({ width: 'three-quarters', grow: false });
    expect(message(stepWidth(layer('root', 'Page', {}, [text('a', 'fit')]), 'a', -1))).toBe('This is as narrow as it gets.');
  });

  it('keeps grow except at the whole row', () => {
    const root = must(stepWidth(layer('root', 'Page', {}, [text('a', 'third', true)]), 'a', 1));
    expect(sizing(root, 'a')).toEqual({ width: 'half', grow: true });
    const whole = must(stepWidth(layer('root', 'Page', {}, [text('a', 'three-quarters', true)]), 'a', 1));
    expect(Object.hasOwn(get(whole, 'a'), 'sizing')).toBe(false);
  });

  it('moves the handle of a pair from the left or the right part', () => {
    const fromLeft = must(stepWidth(pagePair('half', 'half'), 'l', 1));
    expect([sizing(fromLeft, 'l'), sizing(fromLeft, 'r')]).toEqual([
      { width: 'two-thirds', grow: false },
      { width: 'third', grow: false },
    ]);
    const fromRight = stepWidth(pagePair('two-thirds', 'third'), 'r', 1);
    expect(fromRight.ok && fromRight.focusId).toBe('r');
    expect([sizing(must(fromRight), 'l'), sizing(must(fromRight), 'r')]).toEqual([
      { width: 'half', grow: false },
      { width: 'half', grow: false },
    ]);
    const shrinkRight = must(stepWidth(pagePair('half', 'half'), 'r', -1));
    expect(sizing(shrinkRight, 'r')).toEqual({ width: 'third', grow: false });
  });

  it('falls through to a step alone at the end of the pair', () => {
    // Quarter plus three quarters: Widen on the right one makes it the whole row and the quarter stays.
    const root = must(stepWidth(pagePair('quarter', 'three-quarters'), 'r', 1));
    expect(Object.hasOwn(get(root, 'r'), 'sizing')).toBe(false);
    expect(sizing(root, 'l')).toEqual({ width: 'quarter', grow: false });
    // Three quarters plus a quarter: Widen on the left goes alone to the whole row.
    const left = must(stepWidth(pagePair('three-quarters', 'quarter'), 'l', 1));
    expect(Object.hasOwn(get(left, 'l'), 'sizing')).toBe(false);
    // Shrink on the right quarter: the handle is at its end, the quarter steps alone to only what it needs.
    const fit = must(stepWidth(pagePair('three-quarters', 'quarter'), 'r', -1));
    expect(sizing(fit, 'r')).toEqual({ width: 'fit', grow: false });
    expect(sizing(fit, 'l')).toEqual({ width: 'three-quarters', grow: false });
  });

  it('three thirds: Widen on the first refuses rather than wrap the third block', () => {
    const thirds = layer('root', 'Page', {}, [text('a', 'third'), text('b', 'third'), text('c', 'third')]);
    const r = stepWidth(thirds, 'a', 1);
    expect(reason(r)).toBe('at_end');
    expect(message(r)).toBe('That would move another part of this row to a different line.');
    expect(reason(stepWidth(thirds, 'b', 1))).toBe('at_end');
    // Shrink still works: the first block steps alone to a quarter and the line stays as it is.
    const shrunk = must(stepWidth(thirds, 'a', -1));
    expect([sizing(shrunk, 'a'), sizing(shrunk, 'b'), sizing(shrunk, 'c')]).toEqual([
      { width: 'quarter', grow: false },
      { width: 'third', grow: false },
      { width: 'third', grow: false },
    ]);
  });

  it('refuses like setSizing', () => {
    expect(reason(stepWidth(tree(), 'missing', 1))).toBe('not_found');
    expect(reason(stepWidth(tree(), 'root', 1))).toBe('root_locked');
    expect(reason(stepWidth(tree(), 'k1', 1))).toBe('inside_block');
    expect(reason(stepWidth(tree(), 'tab1', 1))).toBe('no_sizing');
    expect(reason(stepWidth(tree(), 'g1', 1))).toBe('no_sizing');
  });

  it('never changes its input', () => {
    const root = pagePair('half', 'half');
    const before = JSON.stringify(root);
    stepWidth(root, 'l', 1);
    stepWidth(root, 'r', -1);
    resizePair(root, 'l', 2);
    setSizing(root, 'l', { width: 'quarter', grow: true });
    expect(JSON.stringify(root)).toBe(before);
  });
});

describe('replaceLayer keeps the placement', () => {
  it('the new layer takes the old width, none when the old had none, none for a Tab', () => {
    const kept = must(replaceLayer(tree(), 'b', layer('b2', 'Card', {}, [])));
    expect(sizing(kept, 'b2')).toEqual({ width: 'half', grow: false });
    const none = must(replaceLayer(tree(), 'a', { ...layer('a2', 'Card', {}, []), sizing: { width: 'third', grow: false } }));
    expect(Object.hasOwn(get(none, 'a2'), 'sizing')).toBe(false);
    const tab = must(replaceLayer(tree(), 'tab1', { ...layer('tab9', 'Tab', { label: 'T' }, []), sizing: { width: 'third', grow: false } }));
    expect(Object.hasOwn(get(tab, 'tab9'), 'sizing')).toBe(false);
  });
});
