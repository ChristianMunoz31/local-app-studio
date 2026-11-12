// ADR-006: the server imports TypeScript directly (Node type stripping), so every .ts file it reaches must be erasable.
// Vitest and esbuild accept more than plain Node does, so this runs real Node processes.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as spec from '../../spec/index.js';
import { compileSpec, planMigration } from '../../spec/compile.js';
import { childEnv } from '../helpers/childEnv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runNode = (code) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: childEnv({}), encoding: 'utf8', timeout: 60_000 });

describe('server/spec/index.js', () => {
  it('re-exports the whole schema module (in Vitest)', () => {
    expect(spec.validateAppSpec).toBeTypeOf('function');
    expect(spec.AppSpecSchema).toBeDefined();
    expect(spec.LIMITS.layersPerPage).toBe(300);
  });

  it('loads in plain Node 24 and validates a spec', () => {
    const out = runNode(
      "import { validateAppSpec, formatIssues } from './server/spec/index.js';" +
        'const r = validateAppSpec({});' +
        "console.log(JSON.stringify({ ok: r.ok, n: r.issues.length, text: typeof formatIssues(r.issues) }));",
    );
    expect(JSON.parse(out)).toEqual({ ok: false, n: expect.any(Number), text: 'string' });
  });

  it('loads the pure catalog files the Studio server imports, in plain Node', () => {
    const out = runNode(
      "import { PART_DEFINITIONS } from './src/catalog/definitions.ts';" +
        "import { checkLayer } from './src/catalog/validateLayout.ts';" +
        "import { SPIKE_PART_CONTEXT } from './src/catalog/types.ts';" +
        "const root = { id: 'r', type: 'Page', props: {}, children: [{ id: 'x', type: 'Nope', props: {}, children: [] }] };" +
        "console.log(JSON.stringify({ parts: PART_DEFINITIONS.length, codes: checkLayer(root, SPIKE_PART_CONTEXT, 'layout').map((i) => i.code) }));",
    );
    expect(JSON.parse(out)).toEqual({ parts: 34, codes: ['unknown_part'] });
  });

  it('loads the Studio routes in plain Node (they import the schema and the catalog)', () => {
    const out = runNode("import { registerStudioRoutes } from './server/studio/routes.js'; console.log(typeof registerStudioRoutes);");
    expect(out.trim()).toBe('function');
  });
});

describe('server/spec/compile.js', () => {
  it('refuses a spec that is not structurally valid', () => {
    expect(() => compileSpec({})).toThrow('invalid_spec');
    expect(planMigration(null, {})).toMatchObject({ ok: false });
  });

  it('does not import zod or the schema (a built app has neither)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(path.join(ROOT, 'server', 'spec', 'compile.js'), 'utf8');
    expect(source).not.toMatch(/from ['"](zod|\.\/index\.js|\.\.\/\.\.\/src\/spec|@local-app-studio\/runtime\/spec)/);
  });
});
