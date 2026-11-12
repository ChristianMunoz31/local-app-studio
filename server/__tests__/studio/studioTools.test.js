// The Studio Assistant's read-only list_features tool: result shape, query filter, counts computed in code, its cloud
// category and the withheld placeholder. Runs against the real temp database through executeTool.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';
import { seedFeature } from '../helpers/seedFeature.js';

vi.mock('../../../loadEnv.js', () => ({}));

import { STUDIO_TOOLS, runStudioTool } from '../../modules/studio.tools.js';
import * as disabled from '../../modules/studio.tools.disabled.js';
import { ASSISTANT_TOOLS, INTERNAL_TOOLS, WRITE_TOOLS, executeTool } from '../../agents/assistantTools.js';
import { validateToolArgs } from '../../agents/toolCalls.js';
import { TOOL_CATEGORIES, createAiPolicy, withheldToolResult } from '../../ai/privacy.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('the Studio tool list', () => {
  it('offers list_features only: no Items tool and no write tool', () => {
    expect(STUDIO_TOOLS.map((t) => t.function.name)).toEqual(['list_features']);
    expect(ASSISTANT_TOOLS).toBe(STUDIO_TOOLS);
    expect(INTERNAL_TOOLS).toBe(ASSISTANT_TOOLS);
    expect(WRITE_TOOLS.size).toBe(0);
    expect(STUDIO_TOOLS[0].function.parameters.additionalProperties).toBe(false);
  });

  it('maps to the features category', () => {
    expect(TOOL_CATEGORIES.list_features).toBe('features');
  });

  it('validates the optional query and refuses unknown arguments', () => {
    expect(validateToolArgs('list_features', {}, ASSISTANT_TOOLS)).toEqual({ ok: true, args: {} });
    expect(validateToolArgs('list_features', { query: 'kpi' }, ASSISTANT_TOOLS)).toEqual({ ok: true, args: { query: 'kpi' } });
    expect(validateToolArgs('list_features', { sql: 'x' }, ASSISTANT_TOOLS).ok).toBe(false);
  });

  it('the disabled twin offers nothing and answers Unknown tool', async () => {
    expect(disabled.STUDIO_TOOLS).toEqual([]);
    expect(await disabled.runStudioTool('list_features')).toEqual({ error: 'Unknown tool: list_features' });
    expect(await runStudioTool('add_item', {})).toEqual({ error: 'Unknown tool: add_item' });
  });
});

describe('list_features', () => {
  it('is empty on a fresh database', async () => {
    expect(await executeTool('list_features', {}, {})).toEqual({ features: [], total: 0 });
  });

  it('returns id, name, description, version, settings and a usedByApps count computed in code', async () => {
    seedFeature({ description: 'Shows a big number.' });
    const out = await executeTool('list_features', {}, {});
    expect(out.total).toBe(1);
    expect(out.features[0]).toEqual({
      id: 'kpi_row',
      name: expect.any(String),
      description: 'Shows a big number.',
      version: 1,
      settings: expect.arrayContaining([expect.objectContaining({ name: expect.any(String), label: expect.any(String), type: expect.any(String) })]),
      usedByApps: 0,
    });
    for (const s of out.features[0].settings) expect(Object.keys(s).sort()).toEqual(['label', 'name', 'type']);
  });

  it('filters by query, case-insensitively, over name and description; the query is never used as SQL', async () => {
    seedFeature({ description: 'Shows a big number.' });
    expect((await executeTool('list_features', { query: 'BIG NUMBER' }, {})).features).toHaveLength(1);
    expect((await executeTool('list_features', { query: 'nothing like it' }, {})).total).toBe(0);
    expect((await executeTool('list_features', { query: "'; DROP TABLE studio_features; --" }, {})).total).toBe(0);
    expect((await executeTool('list_features', {}, {})).total).toBe(1);
  });
});

describe('under cloud AI', () => {
  it('a withheld features category returns the placeholder and never runs the tool', async () => {
    seedFeature({ description: 'Secret wording.' });
    const policy = createAiPolicy({ isCloud: true, categories: { features: false } });
    const out = await executeTool('list_features', {}, { policy });
    expect(out).toEqual(withheldToolResult('features'));
    expect(JSON.stringify(out)).not.toContain('Secret wording');
  });

  it('a shared features category runs it', async () => {
    seedFeature();
    const policy = createAiPolicy({ isCloud: true, categories: { features: true } });
    expect((await executeTool('list_features', {}, { policy })).features).toHaveLength(1);
  });
});
