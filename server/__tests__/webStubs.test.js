// The web build stubs (scripts/lib/webStubs): vite.config.js adds them for `build` only, they point at existing files, they export what the
// real zod modules export, they throw one plain sentence, and the one function that stays real is the installed one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.js';
import { WEB_STUB_BARE, WEB_STUB_FILES, webStubsPlugin } from '../../scripts/lib/webStubs/index.js';
import { WEB_STUB_MESSAGE } from '../../scripts/lib/webStubs/message.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flatten = (list) => list.flat(Infinity).filter(Boolean);
const pluginNames = (command) => flatten(viteConfig({ command, mode: 'production' }).plugins).map((p) => p.name);

/** Export names of an installed ESM file. */
const exportNames = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of source.matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
};

describe('web build stubs', () => {
  it('the config adds the stub plugin for build and for nothing else', () => {
    expect(pluginNames('build')).toContain('las-web-stubs');
    expect(pluginNames('serve')).not.toContain('las-web-stubs');
  });

  it('every stub is an existing file and every replaced module is installed', () => {
    for (const [tail, stub] of Object.entries(WEB_STUB_FILES)) {
      expect(fs.existsSync(stub), stub).toBe(true);
      expect(fs.existsSync(path.join(ROOT, tail)), tail).toBe(true);
    }
    for (const [specifier, stub] of Object.entries(WEB_STUB_BARE)) {
      expect(fs.existsSync(stub), stub).toBe(true);
      expect(fs.existsSync(path.join(ROOT, 'node_modules', specifier, 'package.json')), specifier).toBe(true);
    }
  });

  it('the plugin resolves zod relative imports and the gfm specifier to the stubs, and nothing else', () => {
    const plugin = webStubsPlugin();
    const zodCore = path.join(ROOT, 'node_modules', 'zod', 'v4', 'core');
    const processors = plugin.resolveId('./json-schema-processors.js', path.join(zodCore, 'json-schema-generator.js'));
    expect(processors).toBe(WEB_STUB_FILES['node_modules/zod/v4/core/json-schema-processors.js']);
    const classic = path.join(ROOT, 'node_modules', 'zod', 'v4', 'classic', 'schemas.js');
    expect(plugin.resolveId('../core/to-json-schema.js', classic)).toBe(WEB_STUB_FILES['node_modules/zod/v4/core/to-json-schema.js']);
    expect(plugin.resolveId('mdast-util-gfm', path.join(ROOT, 'node_modules', 'remark-gfm', 'lib', 'index.js'))).toBe(WEB_STUB_BARE['mdast-util-gfm']);
    expect(plugin.resolveId('./util.js', path.join(zodCore, 'schemas.js'))).toBeNull();
    expect(plugin.resolveId('mdast-util-gfm-table', path.join(ROOT, 'node_modules', 'mdast-util-gfm', 'lib', 'index.js'))).toBeNull();
    expect(plugin.resolveId('./to-json-schema.js', path.join(ROOT, 'src', 'other', 'x.js'))).toBeNull();
  });

  it('the stubs are used by vite build only: the sidecar bundler, vitest and the server never name them', () => {
    for (const file of ['scripts/desktop/buildSidecar.js', 'vitest.config.js']) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8'), file).not.toMatch(/webStubs/);
    }
  });

  it('the zod stubs export every name of the real modules and throw the plain sentence', async () => {
    const pairs = [
      ['node_modules/zod/v4/core/to-json-schema.js', WEB_STUB_FILES['node_modules/zod/v4/core/to-json-schema.js']],
      ['node_modules/zod/v4/core/json-schema-processors.js', WEB_STUB_FILES['node_modules/zod/v4/core/json-schema-processors.js']],
    ];
    for (const [real, stub] of pairs) {
      const mod = await import(pathToFileURL(stub).href);
      expect(Object.keys(mod).sort(), real).toEqual(
        expect.arrayContaining(exportNames(path.join(ROOT, real))),
      );
      for (const [name, value] of Object.entries(mod)) {
        if (name === 'aggregateChecks' || name === 'allProcessors' || name === 'createToJSONSchemaMethod' || name === 'createStandardJSONSchemaMethod') continue;
        expect(() => value(), name).toThrow(new Error(WEB_STUB_MESSAGE));
      }
    }
    expect(WEB_STUB_MESSAGE).toBe('JSON schema output is not in the web build');
    const tojson = await import(pathToFileURL(pairs[0][1]).href);
    expect(() => tojson.createToJSONSchemaMethod({}, {})()).toThrow(WEB_STUB_MESSAGE);
    expect(() => tojson.createStandardJSONSchemaMethod({}, 'input')()).toThrow(WEB_STUB_MESSAGE);
  });

  it('aggregateChecks in the stub is a verbatim copy of the installed function', () => {
    const body = (file) => {
      const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      const start = source.indexOf('const narrowMin');
      const end = source.indexOf('\nconst formatMap');
      return start >= 0 && end > start ? source.slice(start, end).trim() : source.slice(start, source.indexOf('\nexport const stringProcessor')).trim();
    };
    const real = body(path.join(ROOT, 'node_modules/zod/v4/core/json-schema-processors.js'));
    const stub = body(WEB_STUB_FILES['node_modules/zod/v4/core/json-schema-processors.js']);
    expect(stub).toBe(real);
  });

  it('the gfm stub keeps the five parse extensions and has no to-markdown extension', async () => {
    const mod = await import(pathToFileURL(WEB_STUB_BARE['mdast-util-gfm']).href);
    const real = await import('mdast-util-gfm');
    expect(mod.gfmFromMarkdown()).toHaveLength(5);
    // Same extension objects, in the same order, as the real package: tables, autolinks, strikethrough and task lists parse as before.
    expect(mod.gfmFromMarkdown()).toEqual(real.gfmFromMarkdown());
    expect(mod.gfmToMarkdown()).toEqual({ extensions: [] });
  });
});
