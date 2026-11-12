import { describe, expect, it } from 'vitest';
import { restoreScroll, saveScroll } from '../canvasScroll';

function scroller(parent: Element, top: number, left: number): HTMLElement {
  const el = document.createElement('div');
  let t = top;
  let l = left;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => t, set: (v: number) => void (t = v) });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => l, set: (v: number) => void (l = v) });
  parent.appendChild(el);
  return el;
}

describe('canvasScroll', () => {
  it('records the root and the descendants that are scrolled, and only those', () => {
    const root = document.createElement('div');
    const moved = scroller(root, 40, 0);
    const sideways = scroller(moved, 0, 7);
    const still = scroller(root, 0, 0);
    const marks = saveScroll(root);
    expect(marks.map((m) => m.el)).toEqual([moved, sideways]);
    expect(marks.find((m) => m.el === moved)).toMatchObject({ top: 40, left: 0 });
    expect(marks.find((m) => m.el === sideways)).toMatchObject({ top: 0, left: 7 });
    expect(marks.some((m) => m.el === still)).toBe(false);
  });

  it('includes the root itself when it is scrolled', () => {
    const holder = document.createElement('div');
    const root = scroller(holder, 12, 3);
    expect(saveScroll(root)).toEqual([{ el: root, top: 12, left: 3 }]);
  });

  it('puts the saved positions back after they were reset', () => {
    const root = document.createElement('div');
    const a = scroller(root, 40, 5);
    const b = scroller(root, 9, 0);
    const marks = saveScroll(root);
    a.scrollTop = 0;
    a.scrollLeft = 0;
    b.scrollTop = 0;
    restoreScroll(marks);
    expect([a.scrollTop, a.scrollLeft, b.scrollTop, b.scrollLeft]).toEqual([40, 5, 9, 0]);
  });

  it('records nothing for a subtree that is not scrolled', () => {
    const root = document.createElement('div');
    scroller(root, 0, 0);
    expect(saveScroll(root)).toEqual([]);
  });
});
