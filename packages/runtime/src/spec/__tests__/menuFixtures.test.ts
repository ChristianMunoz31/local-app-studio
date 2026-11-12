/// <reference types="vite/client" />
// Golden fixtures for the optional spec menu block (docs/APP_SPEC.md "Menu bar"). Each fixture in fixtures/menu/ holds a
// menu block (or none) and what the validator must answer: the parsed block, or the issue paths and codes. Synthetic data.
import { describe, expect, it } from 'vitest';
import crew from '../fixtures/crew-roster.json';
import { normalizeSpec } from '../../runtime/normalizeSpec.js';
import { menuLook } from '../../catalog/parts/navItems.ts';
import { AppSpecSchema, MENU_POSITIONS, MENU_STYLES, validateAppSpec } from '../schema.ts';

interface Fixture {
  name: string;
  description: string;
  menu: unknown;
  absent: boolean;
  expected: { ok: true; menu: unknown } | { ok: false; issues: Array<{ path: string; code: string }> };
}

// Read as text and parsed with JSON.parse: a bundler's JSON module would turn a "__proto__" key into a prototype.
const RAW = import.meta.glob('./fixtures/menu/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const FIXTURES = Object.values(RAW).map((text) => JSON.parse(text) as Fixture);
const withMenu = (fixture: Fixture): Record<string, unknown> => {
  const spec: Record<string, unknown> = { ...(crew as Record<string, unknown>) };
  if (!fixture.absent) spec.menu = fixture.menu;
  return spec;
};

describe('menu golden fixtures', () => {
  it('has the nine fixtures, each named once', () => {
    expect(FIXTURES.map((f) => f.name).sort()).toEqual([
      'absent',
      'empty-block',
      'extra-key',
      'not-an-object',
      'proto-key',
      'side-icons',
      'top-labels',
      'unknown-position',
      'unknown-style',
    ]);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = validateAppSpec(withMenu(fixture));
      if (fixture.expected.ok) {
        expect(result.ok).toBe(true);
        if (fixture.expected.menu === null) expect('menu' in (result.value ?? {})).toBe(false);
        else expect(result.value?.menu).toEqual(fixture.expected.menu);
      } else {
        expect(result.ok).toBe(false);
        expect(result.issues.map((i) => ({ path: i.path, code: i.code }))).toEqual(fixture.expected.issues);
      }
    });

    it(`${fixture.name}: the runtime never reads anything unsafe`, () => {
      const out = menuLook((normalizeSpec(withMenu(fixture)) as { menu?: unknown } | null)?.menu);
      expect(typeof out.side).toBe('boolean');
      expect(typeof out.labelsOnly).toBe('boolean');
      if (fixture.expected.ok && fixture.expected.menu !== null) {
        const parsed = fixture.expected.menu as { position: string; style: string };
        expect(MENU_POSITIONS).toContain(parsed.position);
        expect(MENU_STYLES).toContain(parsed.style);
        expect(out).toEqual({ side: parsed.position === 'side', labelsOnly: parsed.style === 'labels' });
      }
    });
  }

  it('the runtime falls back to the defaults for any value outside the two enums', () => {
    for (const bad of [null, undefined, 'side', 7, [], { position: 'bottom' }, { position: 'SIDE', style: 'LABELS' }, { position: { toString: 'side' } }]) {
      expect(menuLook(bad), JSON.stringify(bad)).toEqual({ side: false, labelsOnly: false });
    }
    expect(menuLook({ position: 'side', style: 'labels' })).toEqual({ side: true, labelsOnly: true });
  });

  it('a spec without menu parses to the same value as before: no menu key', () => {
    const parsed = AppSpecSchema.parse(crew);
    expect(Object.keys(parsed)).not.toContain('menu');
    expect(Object.keys(normalizeSpec(crew) ?? {})).not.toContain('menu');
  });
});
