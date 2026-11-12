import { describe, expect, it } from 'vitest';
import crewRoster from '../fixtures/crew-roster.json';
import { MENU_POSITIONS, MENU_STYLES, MenuSchema, validateAppSpec } from '../schema.ts';
import type { AppSpecInput } from '../schema.ts';

const withMenu = (menu: unknown): AppSpecInput => ({ ...(crewRoster as AppSpecInput), menu }) as AppSpecInput;

describe('the optional menu block', () => {
  it('is absent by default: a spec without menu validates to a value with no menu key', () => {
    const result = validateAppSpec(crewRoster);
    expect(result.ok).toBe(true);
    if (result.ok) expect('menu' in result.value).toBe(false);
  });

  it('fills its own defaults when the block is present', () => {
    expect(MenuSchema.parse({})).toEqual({ position: 'top', style: 'icons-and-labels' });
    const result = validateAppSpec(withMenu({ position: 'side' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.menu).toEqual({ position: 'side', style: 'icons-and-labels' });
    expect(MENU_POSITIONS).toEqual(['top', 'side']);
    expect(MENU_STYLES).toEqual(['labels', 'icons-and-labels']);
  });

  it('rejects an unknown position, style or key, and a block that is not an object', () => {
    for (const bad of [{ position: 'bottom' }, { style: 'icons' }, { position: 'top', extra: 1 }, 'top', null, []]) {
      expect(validateAppSpec(withMenu(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
