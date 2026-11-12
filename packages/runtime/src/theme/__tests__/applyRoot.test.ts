import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRuntimeTheme } from '../applyRoot.ts';
import { THEME_VARIABLES, LEGACY_VARIABLES } from '../variables.ts';

const html = document.documentElement;
let stop: (() => void) | null = null;

interface FakeList {
  matches: boolean;
  listeners: Set<() => void>;
}
const lists = new Map<string, FakeList>();

function installMatchMedia(): void {
  lists.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const list = lists.get(query) ?? { matches: false, listeners: new Set<() => void>() };
      lists.set(query, list);
      return {
        get matches() {
          return list.matches;
        },
        media: query,
        addEventListener: (_type: string, fn: () => void) => list.listeners.add(fn),
        removeEventListener: (_type: string, fn: () => void) => list.listeners.delete(fn),
      };
    },
  });
}

const setVars = (): string[] => THEME_VARIABLES.filter((name) => html.style.getPropertyValue(name) !== '');

beforeEach(() => {
  html.removeAttribute('style');
  html.classList.remove('light');
  document.body.removeAttribute('style');
  installMatchMedia();
});

afterEach(() => {
  stop?.();
  stop = null;
  html.removeAttribute('style');
  html.classList.remove('light');
  document.body.removeAttribute('style');
});

const start = (raw: unknown) => {
  const handle = startRuntimeTheme(raw);
  stop = handle.stop;
  return handle;
};

describe('startRuntimeTheme', () => {
  it('sets only names from the contract, as inline custom properties', () => {
    start({ preset: 'forest', radius: 'md', id: 'forest' });
    const style = html.getAttribute('style') ?? '';
    const names = [...style.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) expect(THEME_VARIABLES as readonly string[]).toContain(name);
    expect(setVars().length).toBe(names.length);
    expect(document.body.style.fontFamily).toBe('var(--font-sans)');
    expect(document.querySelector('style')).toBeNull();
  });

  it('re-applies when the light class changes', async () => {
    start({ id: 'slate', preset: 'aurora', radius: 'md' });
    const dark = html.style.getPropertyValue('--slate-100');
    html.classList.add('light');
    await new Promise((r) => setTimeout(r, 0));
    const light = html.style.getPropertyValue('--slate-100');
    expect(light).not.toBe('');
    expect(light).not.toBe(dark);
    html.classList.remove('light');
    await new Promise((r) => setTimeout(r, 0));
    expect(html.style.getPropertyValue('--slate-100')).toBe(dark);
  });

  it('re-applies when an accessibility query changes', () => {
    start({ id: 'slate', preset: 'aurora', radius: 'md' });
    const before = html.style.getPropertyValue('--glass-filter');
    expect(before).toMatch(/^blur\(/);
    const reduced = lists.get('(prefers-reduced-transparency: reduce)')!;
    reduced.matches = true;
    for (const fn of reduced.listeners) fn();
    expect(html.style.getPropertyValue('--glass-filter')).toBe('none');
    expect(html.style.getPropertyValue('--mesh-c1')).toBe('transparent');
  });

  it('a Classic theme sets only the corners (the glow is the default background setting, so a saved choice wins) and leaves the body font alone', () => {
    const handle = start({ preset: 'ocean', radius: 'lg' });
    expect(setVars().sort()).toEqual(LEGACY_VARIABLES.filter((n) => !n.startsWith('--mesh-')).sort());
    expect(handle).toMatchObject({ themed: false, background: 'ocean' });
    expect(html.style.getPropertyValue('--radius-md')).toBe('0.5rem');
    expect(document.body.style.fontFamily).toBe('');
  });

  it('returns the label and the mode a fresh install starts in', () => {
    expect(start({ id: 'midnight', preset: 'ocean', radius: 'lg' })).toMatchObject({ label: 'Midnight', mode: 'dark', themed: true, background: null });
    stop?.();
    expect(start({ id: 'midnight', preset: 'ocean', radius: 'lg', overrides: { mode: 'light' } })).toMatchObject({ mode: 'light' });
    stop?.();
    expect(start({ preset: 'aurora', radius: 'md' })).toMatchObject({ label: 'Classic', mode: 'light' });
  });

  it('does not add or remove the light class itself', () => {
    start({ id: 'midnight', preset: 'ocean', radius: 'lg' });
    expect(html.classList.contains('light')).toBe(false);
  });

  it('survives junk and hostile input without throwing or writing anything unsafe', () => {
    for (const raw of [undefined, null, 5, 'x', [], { id: 'a;b', overrides: { accentHue: 'x}' } }]) {
      start(raw);
      for (const name of THEME_VARIABLES) expect(html.style.getPropertyValue(name)).not.toMatch(/[<>{}]|url\(/);
      stop?.();
    }
  });

  it('stop() removes what it set and detaches the listeners', () => {
    const handle = startRuntimeTheme({ id: 'forest', preset: 'forest', radius: 'md' });
    expect(setVars().length).toBeGreaterThan(0);
    handle.stop();
    expect(setVars()).toEqual([]);
    expect([...lists.values()].every((l) => l.listeners.size === 0)).toBe(true);
  });
});

describe('startRuntimeTheme: the plain look', () => {
  const start = (raw: unknown) => {
    const handle = startRuntimeTheme(raw);
    stop = handle.stop;
    return handle;
  };

  it('paints a pearl page in light mode, sets no mesh variable, and hands back the solid background', () => {
    html.classList.add('light');
    const handle = start({ preset: 'solid', radius: 'md' });
    expect(handle).toMatchObject({ themed: false, background: 'solid', mode: 'light' });
    expect(html.style.getPropertyValue('--body-bg')).toBe('rgb(251, 249, 246)');
    expect(setVars().filter((name) => name.startsWith('--mesh-'))).toEqual([]);
  });

  it('paints a flat dark page in dark mode, and removes its own page color on stop', () => {
    html.classList.add('light');
    const handle = start({ preset: 'solid', radius: 'md' });
    html.classList.remove('light');
    return Promise.resolve().then(() => {
      expect(html.style.getPropertyValue('--body-bg')).toBe('rgb(22, 19, 16)');
      expect(html.style.getPropertyValue('--body-bg')).not.toContain('gradient');
      html.classList.add('light');
      return Promise.resolve().then(() => {
        expect(html.style.getPropertyValue('--body-bg')).toBe('rgb(251, 249, 246)');
        handle.stop();
        expect(html.style.getPropertyValue('--body-bg')).toBe('');
      });
    });
  });

  it('does not touch the page color of any other Classic glow', () => {
    html.classList.add('light');
    start({ preset: 'aurora', radius: 'md' });
    expect(html.style.getPropertyValue('--body-bg')).toBe('');
  });
});

