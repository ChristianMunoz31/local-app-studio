// executeTool hardening: writes are never raced against the tool timer (so a slow local write
// is still counted toward the cap), and tool failures reach the model as fixed strings,
// except the data layer's own validation messages the model needs to correct its call.
// Studio mode has no write tool, so a probe write is registered in WRITE_TOOLS for the write cases.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../modules/studio.tools.js', () => ({
  STUDIO_TOOLS: [],
  runStudioTool: vi.fn(),
}));

import { runStudioTool } from '../modules/studio.tools.js';
import { TOOL_ERRORS, WRITE_TOOLS, executeTool } from '../agents/assistantTools.js';
import { DbError } from '../db/errors.js';
import { NetworkOptInError } from '../netPolicy.js';

const savedTimeout = process.env.ASSISTANT_TOOL_TIMEOUT_MS;
beforeEach(() => WRITE_TOOLS.add('write_probe'));
afterEach(() => {
  WRITE_TOOLS.delete('write_probe');
  if (savedTimeout === undefined) delete process.env.ASSISTANT_TOOL_TIMEOUT_MS;
  else process.env.ASSISTANT_TOOL_TIMEOUT_MS = savedTimeout;
  vi.resetAllMocks();
});

const later = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));

describe('L1: write tools are not raced against the timeout', () => {
  it('waits for a slow write and counts it toward the cap', async () => {
    process.env.ASSISTANT_TOOL_TIMEOUT_MS = '5';
    runStudioTool.mockImplementation(() => later(40, { added: { id: 't1', name: 'x' } }));
    const ctx = { writeCount: 0, writeCap: 3 };
    const result = await executeTool('write_probe', { name: 'x' }, ctx);
    expect(result).toEqual({ added: { id: 't1', name: 'x' } });
    expect(ctx.writeCount).toBe(1);
  });

  it('still times out a slow read', async () => {
    process.env.ASSISTANT_TOOL_TIMEOUT_MS = '5';
    runStudioTool.mockImplementation(() => later(40, {}));
    expect(await executeTool('list_features', {}, {})).toEqual({ error: TOOL_ERRORS.timeout });
  });

  it('refuses a write past the cap without running it', async () => {
    const ctx = { writeCount: 3, writeCap: 3 };
    const result = await executeTool('write_probe', { name: 'x' }, ctx);
    expect(result.error).toMatch(/Write limit \(3\) reached/);
    expect(runStudioTool).not.toHaveBeenCalled();
  });
});

describe('L9: tool errors are fixed strings', () => {
  it('keeps the data layer validation message the model needs', async () => {
    runStudioTool.mockRejectedValue(Object.assign(new Error('Name is required.'), { status: 400 }));
    expect(await executeTool('write_probe', { name: '' }, { writeCount: 0, writeCap: 3 })).toEqual({ error: 'Name is required.' });
  });

  it('maps storage, network and unknown failures, never echoing their text', async () => {
    runStudioTool.mockRejectedValue(new DbError('db_unavailable', 'SQLITE_CANTOPEN /home/someone/secret/path'));
    expect(await executeTool('write_probe', { name: 'x' }, {})).toEqual({ error: TOOL_ERRORS.storage });

    runStudioTool.mockRejectedValue(new Error('internal stack detail at /srv/app.js:12'));
    expect(await executeTool('list_features', {}, {})).toEqual({ error: TOOL_ERRORS.failed });

    runStudioTool.mockRejectedValue(new NetworkOptInError('updates'));
    expect(await executeTool('list_features', {}, {})).toEqual({ error: TOOL_ERRORS.network });
  });

  it('a 500-class error with a message is not passed through', async () => {
    runStudioTool.mockRejectedValue(Object.assign(new Error('upstream body: {"detail":"key abc"}'), { status: 502 }));
    expect(await executeTool('list_features', {}, {})).toEqual({ error: TOOL_ERRORS.failed });
  });
});
