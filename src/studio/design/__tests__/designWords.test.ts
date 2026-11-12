// The words of the Design status line and of Move to... (DESIGN-phase14.md P-23, P-29, P-30, P-28). Pure.
import { describe, expect, it } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { hasPlaceholderText, PLACEHOLDER_WARNING } from '../../lib/placeholderText';
import { entryLabel, redidNotice, undidNotice } from '../../lib/historyWords';
import { REDID, UNDID, addedLabel, historyLine, labelOf, movingWords, noPlaceWords, pillAlign, sentenceOf } from '../designWords';
import { HERE, placeNumber, placeRows } from '../movePlaces';

const layer = (id: string, type: string, children: LayoutLayer['children'] = [], props: LayoutLayer['props'] = {}): LayoutLayer => ({ id, type, props, children });
const page = layer('root', 'Page', [layer('a', 'Text', 'One'), layer('b', 'Heading', 'Two', { level: 2 }), layer('c', 'Text', 'Three')]);

describe('the status line of a step (P-23)', () => {
  it('says a step as a sentence and an Undo or Redo with its lead word', () => {
    expect(sentenceOf('moved Tabs down')).toBe('Moved Tabs down.');
    expect(historyLine(UNDID, 'moved Tabs down')).toBe('Undid: moved Tabs down.');
    expect(historyLine(REDID, 'moved Tabs down')).toBe('Redid: moved Tabs down.');
  });

  it('turns a line back into the label of its step', () => {
    expect(labelOf('Put Number tile beside Table of records. Both take half the row.')).toBe('put Number tile beside Table of records');
    expect(labelOf('Moved Text.')).toBe('moved Text');
  });

  it('names where an added part went', () => {
    expect(addedLabel(page, 'b')).toMatch(/^added .+ after /);
    expect(addedLabel(page, 'a')).toMatch(/^added .+ at the top of the page$/);
    expect(addedLabel(page, 'missing')).toBe('added a part');
  });

  it('shares the Undo and Redo lines with the Data step', () => {
    expect(undidNotice('Removed the field Amount.')).toBe('Undid: removed the field Amount.');
    expect(redidNotice('Removed the field Amount.')).toBe('Redid: Removed the field Amount.');
    expect(entryLabel({ label: 'Edit', notice: 'Removed the field Amount.' })).toBe('Removed the field Amount');
    expect(entryLabel({ label: 'Edit' })).toBe('Edit');
  });

  it('reads Moving <part> when Move to... opens and says when there is no other place', () => {
    expect(movingWords('Tabs')).toBe('Moving Tabs. Pick a place.');
    expect(noPlaceWords('Tabs')).toBe('There is no other place for Tabs.');
  });
});

describe('Move to... places (P-30)', () => {
  const name = (parentId: string): string => (parentId === 'root' ? 'Page' : parentId);

  it('counts the block itself, so the numbers have no gaps', () => {
    const own = { parentId: 'root', index: 1 };
    expect(placeNumber({ parentId: 'root', index: 0 }, own)).toBe(1);
    expect(placeNumber({ parentId: 'root', index: 3 }, own)).toBe(3);
    expect(placeNumber({ parentId: 'col', index: 0 }, own)).toBe(1);
  });

  it('lists the block own place as (here), in order, between the others', () => {
    const rows = placeRows([{ parentId: 'root', index: 0 }, { parentId: 'root', index: 3 }, { parentId: 'col', index: 0 }], { parentId: 'root', index: 1 }, name);
    expect(rows.map((r) => r.label)).toEqual(['Page, place 1', `Page, place 2 ${HERE}`, 'Page, place 3', 'col, place 1']);
    expect(rows.map((r) => r.here)).toEqual([false, true, false, false]);
    expect(rows[1].target).toBeNull();
  });

  it('is the plain list for a block with no place of its own', () => {
    expect(placeRows([{ parentId: 'root', index: 2 }], null, name).map((r) => r.label)).toEqual(['Page, place 3']);
  });
});

describe('Add here pills never sit over a block (P-29)', () => {
  it('puts the pill above the block it comes before, below the one it comes after, above a row', () => {
    expect(pillAlign('before', false)).toBe('items-start');
    expect(pillAlign('after', false)).toBe('items-end');
    expect(pillAlign('after', true)).toBe('items-start');
    expect(pillAlign('fill', false)).toBe('items-center');
  });
});

describe('Save as feature warns about a part still reading Text (P-28)', () => {
  it('finds a Text part with its starting word, however deep', () => {
    expect(hasPlaceholderText(layer('t', 'Text', 'Text'))).toBe(true);
    expect(hasPlaceholderText(layer('c', 'Column', [layer('t', 'Text', 'Text')]))).toBe(true);
    expect(hasPlaceholderText(layer('c', 'Column', [layer('t', 'Text', 'Hello'), layer('h', 'Heading', 'Text', { level: 2 })]))).toBe(false);
    expect(PLACEHOLDER_WARNING).toContain('"Text"');
  });
});
