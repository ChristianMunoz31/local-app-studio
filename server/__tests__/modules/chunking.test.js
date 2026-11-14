// The vendored editor, the catalog, Studio code, the error copy table, zod and the drag and drop library must never land in the entry chunk or in a
// chunk it imports statically (that would load the Design canvas at first paint), and nothing may build the vendored editor
// at all. A real build with the real vite.config.js, in studio mode and in runtime mode (a built app).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORBIDDEN_IN_INITIAL = /\/src\/(catalog|studio|runtime|spec|errors)\/|node_modules\/(zod|zustand|react-hook-form|@dnd-kit|sonner|react-resizable-panels|@radix-ui)\//;

// One real build with the real vite.config.js, in the given app mode (the config reads APP_MODE when it loads).
const buildChunks = async (appMode) => {
  const out = new Map();
  const before = process.env.APP_MODE;
  if (appMode === undefined) delete process.env.APP_MODE;
  else process.env.APP_MODE = appMode;
  try {
    await build({
      root: ROOT,
      logLevel: 'silent',
      build: { write: false },
      plugins: [
        {
          name: 'collect-chunks',
          generateBundle(_options, bundle) {
            for (const [name, chunk] of Object.entries(bundle)) if (chunk.type === 'chunk') out.set(name, chunk);
          },
        },
      ],
    });
  } finally {
    if (before === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = before;
  }
  return out;
};

let chunks = new Map();
let runtimeChunks = new Map();
beforeAll(async () => {
  chunks = await buildChunks('studio');
  runtimeChunks = await buildChunks('runtime');
}, 300_000);

const initialChunks = (all = chunks) => {
  const entry = [...all.values()].find((c) => c.isEntry);
  const seen = new Set();
  const walk = (chunk) => {
    if (seen.has(chunk.fileName)) return;
    seen.add(chunk.fileName);
    for (const name of chunk.imports) if (all.has(name)) walk(all.get(name));
  };
  walk(entry);
  return [...seen].map((name) => all.get(name));
};

describe('initial chunks (entry plus its static imports)', () => {
  it('hold no catalog, Studio code, zod or drag and drop library', () => {
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

  it('name every shared chunk for what it holds, never after one of its modules (phase 31: 201 KB called useDocumentTitle)', () => {
    const idsOf = (c) => Object.keys(c.modules).map((id) => id.replaceAll('\\', '/'));
    expect([...chunks.keys()].filter((name) => /useDocumentTitle/.test(name))).toEqual([]);
    // The one chunk with zod holds the spec schema, the catalog and the Studio libraries the lazy routes share: `spec-shared`, lazy.
    const withZod = [...chunks.values()].filter((c) => idsOf(c).some((id) => id.includes('node_modules/zod/')));
    expect(withZod).toHaveLength(1);
    expect(withZod[0].fileName).toMatch(/^assets\/spec-shared-/);
    expect(initialChunks().some((c) => c.fileName === withZod[0].fileName)).toBe(false);
    expect(idsOf(withZod[0]).some((id) => id.includes('/src/studio/lib/'))).toBe(true);
    // Any other automatic common chunk (not an entry, a page, or a named group) with Studio code is called studio-<module>.
    const GROUPS = new Set(['react', 'editor-libs', 'shared']);
    const common = [...chunks.values()].filter((c) => !c.isEntry && !c.isDynamicEntry && !GROUPS.has(c.name) && c.fileName !== withZod[0].fileName);
    for (const c of common.filter((c) => idsOf(c).some((id) => id.includes('/src/studio/')))) expect(c.fileName, c.fileName).toMatch(/^assets\/studio-/);
    // The kit group `shared` is what the entry imports; it holds no Studio code (the first test checks the initial chunks too).
    const shared = [...chunks.values()].filter((c) => c.name === 'shared');
    expect(shared).toHaveLength(1);
    expect(idsOf(shared[0]).filter((id) => id.includes('/src/studio/') || id.includes('node_modules/zod/'))).toEqual([]);
  });
});

describe('a built app (APP_MODE=runtime)', () => {
  it('has no Studio code, no editor libraries and no zod in any chunk, and no chunk named for them', () => {
    const idsOf = (c) => Object.keys(c.modules).map((id) => id.replaceAll('\\', '/'));
    const hits = [...runtimeChunks.values()].flatMap(idsOf).filter((id) => /\/src\/(vendor|studio)\/|node_modules\/(zod|@dnd-kit)\//.test(id));
    expect(hits).toEqual([]);
    expect([...runtimeChunks.keys()].filter((name) => /studio-|spec-shared|editor-libs|useDocumentTitle/.test(name))).toEqual([]);
  });

  it('keeps the spec schema, the catalog and zod out of the initial chunks', () => {
    const initial = initialChunks(runtimeChunks);
    expect(initial.length).toBeGreaterThanOrEqual(2);
    const hits = initial.flatMap((c) => Object.keys(c.modules)).filter((id) => /\/src\/(vendor|catalog|studio|errors|spec)\/|node_modules\/(zod|@dnd-kit)\//.test(id.replaceAll('\\', '/')));
    expect(hits).toEqual([]);
  });
});
