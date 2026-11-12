import { describe, it, expect, afterEach } from 'vitest';
import { ASSISTANT_TOOLS, INTERNAL_TOOLS, WRITE_TOOLS, executeTool } from '../agents/assistantTools.js';

describe('ASSISTANT_TOOLS registry', () => {
  it('exposes well-formed OpenAI-style function specs with unique names', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.function.name);
    expect(names.length).toBe(new Set(names).size);
    for (const t of ASSISTANT_TOOLS) {
      expect(t.type).toBe('function');
      expect(typeof t.function.name).toBe('string');
      expect(typeof t.function.description).toBe('string');
      expect(t.function.parameters.type).toBe('object');
    }
  });

  it('studio mode offers only the read-only list_features tool', () => {
    expect(ASSISTANT_TOOLS.map((t) => t.function.name)).toEqual(['list_features']);
    expect(INTERNAL_TOOLS).toBe(ASSISTANT_TOOLS);
    expect(WRITE_TOOLS.size).toBe(0);
  });
});

describe('executeTool guards', () => {
  afterEach(() => WRITE_TOOLS.delete('write_probe'));

  it('refuses a write once the per-run cap is reached, without running it', async () => {
    WRITE_TOOLS.add('write_probe');
    const ctx = { writeCount: 3, writeCap: 3 };
    const res = await executeTool('write_probe', { name: 'hi' }, ctx);
    expect(res.error).toMatch(/write limit/i);
    expect(ctx.writeCount).toBe(3);
  });

  it('returns an error object for an unknown tool', async () => {
    const res = await executeTool('does_not_exist', {}, {});
    expect(res.error).toMatch(/unknown tool/i);
  });

  it('has no Items tools any more', async () => {
    for (const name of ['list_items', 'get_item_stats', 'list_item_notes', 'search_data', 'add_item']) {
      expect((await executeTool(name, {}, {})).error).toMatch(/unknown tool/i);
    }
  });
});
