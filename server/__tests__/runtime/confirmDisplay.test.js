// The confirmation display of a parked save lists every changed field, however many there are.
import { describe, expect, it, vi } from 'vitest';
import { compileSpec } from '../../spec/compile.js';

const spec = vi.hoisted(() => ({
  specVersion: 1,
  app: { name: 'Wide', version: '1.0.0' },
  tables: [
    {
      id: 'wide',
      label: 'Wide',
      fields: Array.from({ length: 15 }, (_, i) => ({ id: `f${i}`, label: `Field ${i}`, type: 'text' })),
    },
  ],
  pages: [{ id: 'home', route: '/', title: 'Home', sources: [{ id: 'all', table: 'wide' }], blocks: [] }],
}));

vi.mock('../../spec/source.js', async () => {
  const { compileSpec: compile } = await import('../../spec/compile.js');
  const compiled = compile(spec);
  return { getAppSpec: () => spec, getCompiledSpec: () => compiled };
});

const { precheckRuntimeWrite } = await import('@local-app-studio/runtime/server/assistantTools.js');

describe('precheckRuntimeWrite display', () => {
  it('shows all 15 changed fields', async () => {
    expect(compileSpec(spec).tables.wide).toBeDefined();
    const values = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, `v${i}`]));
    const res = await precheckRuntimeWrite('save_record__wide', { values });
    expect(res.ok).toBe(true);
    expect(res.args.display).toHaveLength(15);
    expect(res.args.display.at(-1)).toEqual({ label: 'Field 14', value: 'v14' });
  });
});
