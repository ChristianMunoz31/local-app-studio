// The vendored editor, the catalog, Studio code, the error copy table, zod and the drag and drop library must never land in the entry chunk or in a
// chunk it imports statically (that would load the Design canvas at first paint), and nothing may build the vendored editor
// at all. A real build with the real vite.config.js.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORBIDDEN_IN_INITIAL = /\/src\/(vendor|catalog|studio|runtime|spec|errors)\/|node_modules\/(zod|zustand|react-hook-form|@dnd-kit|sonner|react-resizable-panels|@radix-ui)\//;

const chunks = new Map();
beforeAll(async () => {
  await build({
    root: ROOT,
    logLevel: 'silent',
    build: { write: false },
    plugins: [
      {
        name: 'collect-chunks',
        generateBundle(_options, bundle) {
          for (const [name, chunk] of Object.entries(bundle)) if (chunk.type === 'chunk') chunks.set(name, chunk);
        },
      },
    ],
  });
}, 180_000);

const initialChunks = () => {
  const entry = [...chunks.values()].find((c) => c.isEntry);
  const seen = new Set();
  const walk = (chunk) => {
    if (seen.has(chunk.fileName)) return;
    seen.add(chunk.fileName);
    for (const name of chunk.imports) if (chunks.has(name)) walk(chunks.get(name));
  };
  walk(entry);
  return [...seen].map((name) => chunks.get(name));
};

describe('initial chunks (entry plus its static imports)', () => {
  it('hold no vendored editor, catalog, Studio code, zod or drag and drop library', () => {
    const initial = initialChunks();
    expect(initial.length).toBeGreaterThanOrEqual(2);
    const hits = initial.flatMap((c) => Object.keys(c.modules)).filter((id) => FORBIDDEN_IN_INITIAL.test(id));
    expect(hits).toEqual([]);
  });

  it('leave the Design and Preview tabs in lazy chunks', () => {
    const initialNames = new Set(initialChunks().map((c) => c.fileName));
    const lazyWith = (fragment) => [...chunks.values()].filter((c) => Object.keys(c.modules).some((id) => id.includes(fragment)));
    for (const fragment of ['/src/studio/pages/DesignTab.tsx', '/src/studio/design/DesignCanvas.tsx', '/src/studio/pages/PreviewTab.tsx']) {
      const holders = lazyWith(fragment);
      expect(holders.length, fragment).toBe(1);
      expect(initialNames.has(holders[0].fileName), fragment).toBe(false);
    }
  });

  it('build no code of the frame or the entry of a built app (a studio build drops the runtime module)', () => {
    // Vitest builds with the dev JSX runtime, which leaves one import line behind in a fully dropped module: look at the code, not the id.
    const code = [...chunks.values()].flatMap((c) => Object.entries(c.modules).filter(([id]) => id.includes('/src/components/shell/Runtime')).map(([, m]) => m.code ?? ''));
    for (const text of code) {
      expect(text).not.toContain('data-runtime-shell');
      expect(text).not.toContain('setupOffered');
      expect(text).not.toContain('Ask the Assistant');
    }
    const allCode = [...chunks.values()].map((c) => c.code).join(' ');
    expect(allCode).not.toContain('data-runtime-shell');
    expect(allCode).not.toContain('Ask the Assistant');
  });

  it('build no chunk with the vendored editor in it', () => {
    const hits = [...chunks.values()].flatMap((c) => Object.keys(c.modules)).filter((id) => id.includes('/src/vendor/'));
    expect(hits).toEqual([]);
  });

  it('keep the drag and drop library in its own lazy chunk, imported by the Design tab only', () => {
    const idsOf = (c) => Object.keys(c.modules);
    const holders = [...chunks.values()].filter((c) => idsOf(c).some((id) => id.includes('node_modules/@dnd-kit/')));
    expect(holders.map((c) => c.name)).toEqual(['editor-libs']);
    const initialNames = new Set(initialChunks().map((c) => c.fileName));
    expect(initialNames.has(holders[0].fileName)).toBe(false);
    const designer = [...chunks.values()].find((c) => idsOf(c).some((id) => id.includes('/src/studio/pages/DesignTab.tsx')));
    expect(designer).toBeDefined();
    expect(idsOf(designer).some((id) => id.includes('node_modules/@dnd-kit/'))).toBe(false);
    const importers = [...chunks.values()].filter((c) => c.imports.includes(holders[0].fileName) || c.dynamicImports.includes(holders[0].fileName));
    expect(importers.length).toBeGreaterThan(0);
    for (const chunk of importers) expect(initialNames.has(chunk.fileName), chunk.fileName).toBe(false);
  });

  it('keep the chunk of the Apps list free of the drag and drop library', () => {
    const idsOf = (c) => Object.keys(c.modules);
    const apps = [...chunks.values()].filter((c) => idsOf(c).some((id) => id.includes('/src/studio/pages/AppsPage.tsx')));
    expect(apps).toHaveLength(1);
    expect(apps[0].imports.filter((name) => name.startsWith('editor-libs'))).toEqual([]);
  });
});
