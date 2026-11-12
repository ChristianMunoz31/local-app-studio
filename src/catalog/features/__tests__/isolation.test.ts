/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Source text of the runtime and of the feature library (not the tests).
const RUNTIME = import.meta.glob(['../../../../packages/runtime/src/runtime/**/*.{ts,tsx,js,jsx}', '!../../../../packages/runtime/src/runtime/**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const LIBRARY = import.meta.glob('../*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('feature library isolation', () => {
  it('is never imported by src/runtime', () => {
    expect(Object.keys(RUNTIME).length).toBeGreaterThan(3);
    const offenders = Object.entries(RUNTIME)
      .filter(([, text]) => /catalog\/features/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('does no I/O and imports only the spec and the catalog, with .ts extensions', () => {
    const files = Object.entries(LIBRARY);
    expect(files.length).toBeGreaterThan(8);
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(/from '(node:|fs'|path'|http'|https'|net'|child_process')/);
      expect(text, file).not.toMatch(/\b(fetch|XMLHttpRequest|localStorage|eval)\s*\(/);
      for (const m of text.matchAll(/from '([^']+)'/g)) {
        expect(m[1], file).toMatch(/^(\.\.?\/|@local-app-studio\/runtime\/)/);
        expect(m[1], file).toMatch(/\.ts$/);
      }
    }
  });
});
