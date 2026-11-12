import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import html from '../../../index.html?raw';

// Executes the real inline pre-paint script from index.html against jsdom.
const SCRIPT = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes('Pre-paint theme/background'));

const root = document.documentElement;
const originalMatchMedia = window.matchMedia;

function reset() {
  localStorage.clear();
  root.className = '';
  root.removeAttribute('data-bg-light');
  root.removeAttribute('data-bg-dark');
}

function run({ light = false } = {}) {
  window.matchMedia = () => ({ matches: light });
  new Function(SCRIPT)();
}

const seed = (k, v) => localStorage.setItem(`app.${k}`, JSON.stringify(v));

beforeEach(reset);
afterEach(() => {
  reset();
  window.matchMedia = originalMatchMedia;
});

describe('index.html pre-paint script', () => {
  it('is present in index.html', () => {
    expect(SCRIPT).toBeTruthy();
  });

  it('applies a saved preset to each theme', () => {
    seed('appearance:bgDark', 'ocean');
    seed('appearance:bgLight', 'forest');
    run();
    expect(root.getAttribute('data-bg-dark')).toBe('ocean');
    expect(root.getAttribute('data-bg-light')).toBe('forest');
  });

  it('knows exactly the presets of BACKGROUND_PRESETS', async () => {
    const { BACKGROUND_PRESET_IDS } = await import('../../constants/settingsDefaults');
    for (const id of BACKGROUND_PRESET_IDS) {
      reset();
      seed('appearance:bgDark', id);
      run();
      expect(root.getAttribute('data-bg-dark'), id).toBe(id);
    }
  });

  it('sets nothing for a value that is not a preset (an old edition-only background included) or when nothing is saved', () => {
    seed('appearance:bgDark', 'nonexistent');
    seed('appearance:bgLight', 'unknown-preset');
    run();
    expect(root.hasAttribute('data-bg-dark')).toBe(false);
    expect(root.hasAttribute('data-bg-light')).toBe(false);
    reset();
    run();
    expect(root.hasAttribute('data-bg-dark')).toBe(false);
  });

  it('applies the light class from the theme preference or the OS', () => {
    seed('theme', 'light');
    run();
    expect(root.classList.contains('light')).toBe(true);
    reset();
    run({ light: true });
    expect(root.classList.contains('light')).toBe(true);
    reset();
    seed('theme', 'dark');
    run({ light: true });
    expect(root.classList.contains('light')).toBe(false);
  });
});
