import { describe, expect, it } from 'vitest';
import { SHORTCUTS, shortcutAreas } from '../shortcuts';

describe('shortcuts for the free grid', () => {
  it('rewords the Alt+Arrow up or down row and drops the old wording', () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(keys).toContain('Alt+Arrow up or Alt+Arrow down on a part that is not placed freely');
    expect(keys).not.toContain('Alt+Arrow up or Alt+Arrow down on a part');
    expect(SHORTCUTS.find((s) => s.keys.startsWith('Alt+Arrow up'))?.does).toBe('Moves it up or down');
  });

  it('follows it with the four grid rows, in order, in the Design area', () => {
    const design = shortcutAreas().find((a) => a.where === 'Design')!.rows;
    const at = design.findIndex((r) => r.keys.startsWith('Alt+Arrow up'));
    expect(design.slice(at + 1, at + 5)).toEqual([
      { where: 'Design', keys: 'Alt+Arrow keys on a part placed freely on a grid', does: 'Moves it one cell' },
      { where: 'Design', keys: 'Alt+Shift+Arrow keys on a part placed freely on a grid', does: 'Makes it one cell wider, narrower, taller or shorter' },
      { where: 'Design', keys: 'Arrow keys on the width or height handle of a part placed freely', does: 'Changes its width or height by one cell' },
      { where: 'Design', keys: 'Home or End on the width or height handle of a part placed freely', does: 'Makes it as small as it can be, or as large as the free room allows' },
    ]);
  });
});
