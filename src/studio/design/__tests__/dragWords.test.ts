import { describe, expect, it } from 'vitest';
import { DRAG_INSTRUCTIONS, DRAG_WORDS, dragAnnouncements, placeWords } from '../dragWords';
import type { DragPlace } from '../dragWords';

const zone: DragPlace = { kind: 'zone', name: 'Page, place 2' };
const side: DragPlace = { kind: 'side', name: 'Table of records' };

describe('placeWords', () => {
  it('says at for a place and beside for a part', () => {
    expect(placeWords(zone)).toBe('at Page, place 2');
    expect(placeWords(side)).toBe('beside Table of records');
  });
});

describe('DRAG_WORDS', () => {
  it('says the six sentences', () => {
    expect(DRAG_WORDS.start('Table of records')).toBe('Picked up Table of records.');
    expect(DRAG_WORDS.over('Table of records', zone)).toBe('Table of records is at Page, place 2.');
    expect(DRAG_WORDS.over('Table of records', null)).toBe('Table of records is not over a place.');
    expect(DRAG_WORDS.end('Table of records', zone)).toBe('Dropped Table of records at Page, place 2.');
    expect(DRAG_WORDS.end('Table of records', side)).toBe('Dropped Table of records beside Table of records.');
    expect(DRAG_WORDS.end('Table of records', null)).toBe('Table of records was not dropped.');
    expect(DRAG_WORDS.cancel('Table of records')).toBe('Stopped moving Table of records.');
  });
  it('never shows an id and is plain ASCII', () => {
    const all = [DRAG_WORDS.start('A'), DRAG_WORDS.over('A', zone), DRAG_WORDS.end('A', zone), DRAG_WORDS.cancel('A'), DRAG_INSTRUCTIONS].join(' ');
    expect(all).not.toMatch(/palette:|zone:/);
    expect(all).toMatch(/^[ -~]*$/);
  });
  it('tells the keyboard way', () => {
    expect(DRAG_INSTRUCTIONS).toBe('To move a part with the keyboard, select it and use Move to... in its toolbar.');
  });
});

describe('dragAnnouncements', () => {
  const words = dragAnnouncements<{ id: string }, { id: string }>({
    label: (a) => (a.id === 'palette:part:DataTable' ? 'Table of records' : a.id),
    place: (o) => (o.id === 'zone:root_home:1' ? zone : o.id === 'side' ? side : null),
  });
  const active = { id: 'palette:part:DataTable' };
  it('reads the part and the place, not the ids', () => {
    expect(words.onDragStart({ active })).toBe('Picked up Table of records.');
    expect(words.onDragOver({ active, over: { id: 'zone:root_home:1' } })).toBe('Table of records is at Page, place 2.');
    expect(words.onDragEnd({ active, over: { id: 'zone:root_home:1' } })).toBe('Dropped Table of records at Page, place 2.');
    expect(words.onDragEnd({ active, over: { id: 'side' } })).toBe('Dropped Table of records beside Table of records.');
    expect(words.onDragCancel({ active })).toBe('Stopped moving Table of records.');
  });
  it('says not dropped or not over a place when there is no place', () => {
    expect(words.onDragOver({ active, over: null })).toBe('Table of records is not over a place.');
    expect(words.onDragEnd({ active, over: null })).toBe('Table of records was not dropped.');
    expect(words.onDragEnd({ active, over: { id: 'unknown' } })).toBe('Table of records was not dropped.');
  });
});
