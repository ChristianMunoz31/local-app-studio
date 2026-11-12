// The menu bar in the Describe review: the summary words, the review line and the diff sentence.
import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { diffSpecs, summarizeChanges } from '../specDiff';
import { menuLine, summarizeSpec } from '../specSummary';

const withMenu = (menu: AppSpec['menu']): AppSpec => {
  const spec = structuredClone(baseSpec());
  if (menu !== undefined) spec.menu = menu;
  return spec;
};

describe('menu in the summary', () => {
  it('is null for Classic and plain words otherwise', () => {
    expect(summarizeSpec(withMenu(undefined)).menu).toBeNull();
    expect(summarizeSpec(withMenu({ position: 'top', style: 'icons-and-labels' })).menu).toBe('across the top, icons and words');
    expect(summarizeSpec(withMenu({ position: 'side', style: 'labels' })).menu).toBe('down the side, words only');
  });

  it('menuLine speaks only for a new or changed menu bar', () => {
    expect(menuLine('across the top, icons and words', null)).toBe('Menu: across the top, icons and words.');
    expect(menuLine('down the side, words only', 'across the top, words only')).toBe('Menu: down the side, words only.');
    expect(menuLine('across the top, words only', 'across the top, words only')).toBeNull();
    expect(menuLine(null, 'across the top, words only')).toBeNull();
  });
});

describe('menu in the diff', () => {
  it('says nothing when both are Classic or equal', () => {
    expect(diffSpecs(withMenu(undefined), withMenu(undefined))).toEqual([]);
    const same = { position: 'side', style: 'labels' } as const;
    expect(diffSpecs(withMenu(same), withMenu({ ...same }))).toEqual([]);
  });

  it('adds, changes and removes the bar', () => {
    const bar = { position: 'top', style: 'labels' } as const;
    expect(diffSpecs(withMenu(undefined), withMenu(bar)).map((c) => [c.kind, c.area, c.destructive])).toEqual([['added', 'menu', false]]);
    const changed = diffSpecs(withMenu(bar), withMenu({ position: 'side', style: 'labels' }));
    expect(changed.map((c) => c.sentence)).toEqual(['Changes the menu bar.']);
    expect(summarizeChanges(changed)).toBe('1 menu bar changed');
    expect(diffSpecs(withMenu(bar), withMenu(undefined)).map((c) => c.sentence)).toEqual(['Removes the menu bar.']);
  });
});

describe('menu parts in the summary', () => {
  const btn = { id: 'b', type: 'Button', props: { action: { action: 'navigate', pageId: 'home', withRecord: false } }, children: 'Go' } as const;

  it('adds how many parts sit on the bar, and says nothing more without parts', () => {
    expect(summarizeSpec(withMenu({ position: 'top', style: 'labels', end: [btn, { ...btn, id: 'c' }] })).menu).toBe('across the top, words only, with 2 parts');
    expect(summarizeSpec(withMenu({ position: 'side', style: 'labels', start: [btn] })).menu).toBe('down the side, words only, with 1 part');
    expect(summarizeSpec(withMenu({ position: 'top', style: 'labels', start: [], end: [] })).menu).toBe('across the top, words only');
  });
});
