import { describe, expect, it, vi } from 'vitest';
import { SURFACE_COPY } from '@/errors/surfaceCopy.js';
import { buildDetails, componentInfo, envelopeFor, fetchLogLines, redactClientText } from '../copyDetails';

const NOW = new Date('2026-11-04T10:12:03.412Z');
const STACK = [
  '',
  '    at Broken (http://localhost:5174/src/studio/pages/DesignTab.tsx?t=12:812:5)',
  '    at div',
  '    at Suspense (http://localhost:5174/node_modules/react/index.js:10:1)',
  '    at StepBoundary (http://localhost:5174/src/studio/errors/StepBoundary.tsx:9:3)',
  '    at Outer (http://localhost:5174/src/x.tsx:1:1)',
].join('\n');

const USERS = 'Users';
const BS = String.fromCharCode(92);
const HOME_DIR = 'home';
const WIN_HOME = ['C:', USERS, 'sam'].join(BS);
const asFetch = (fn: () => Promise<Response>): typeof fetch => fn as unknown as typeof fetch;

describe('redactClientText', () => {
  it('hides home folders, tokens and e-mail addresses', () => {
    const text = redactClientText(`${WIN_HOME}${BS}Documents${BS}a.txt /${USERS}/sam/x /${HOME_DIR}/sam/y sk-test1234567890abcdef Bearer abc.def me@example.com`);
    expect(text).not.toMatch(/sam|sk-test|abc\.def|example\.com/);
    expect(text).toContain('<home>');
  });

  it('hides a home folder whose user name has a space, before the next separator', () => {
    const spaced = [`C:`, USERS, 'Sam Smith'].join(BS);
    const out = redactClientText(`Could not read ${spaced}${BS}Documents${BS}a.txt`);
    expect(out).not.toMatch(/Sam|Smith/);
    expect(out).toContain('<home>');
  });

  it('reduces other absolute Windows paths to <path>/<last segment>', () => {
    const out = redactClientText(`open ${['D:', 'Data', 'Studio', 'app.db'].join(BS)} and D:/work/notes.txt`);
    expect(out).toBe('open <path>/app.db and <path>/notes.txt');
  });

  it('cuts a long value to 2000 characters', () => {
    expect(redactClientText('a'.repeat(5000)).length).toBeLessThanOrEqual(2003);
  });
});

describe('componentInfo', () => {
  it('names the component and keeps the first three frames as file and line', () => {
    const info = componentInfo(STACK);
    expect(info?.component).toBe('Broken');
    expect(info?.frames).toHaveLength(3);
    expect(info?.frames[0]).toBe('src/studio/pages/DesignTab.tsx:812');
    expect(info?.frames.join(' ')).not.toMatch(/localhost|\?t=/);
  });

  it('is null without a stack', () => {
    expect(componentInfo(null)).toBeNull();
    expect(componentInfo('')).toBeNull();
  });
});

describe('buildDetails', () => {
  const envelope = envelopeFor(new Error('boom'), STACK);

  it('lists when, where, what, next, the envelope and the log lines', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `{"level":"info","n":${i}}`);
    const text = buildDetails({ envelope, stepLabel: 'Design', path: '/apps/abc/design', logLines: lines, now: NOW });
    const rows = text.split('\n');
    expect(rows[0]).toBe('Local App Studio error details');
    expect(rows[1]).toBe('When: 2026-11-04T10:12:03.412Z');
    expect(rows[2]).toBe('Where: Design step, /apps/abc/design');
    expect(rows[3]).toContain('(render_failed)');
    expect(rows[4]).toMatch(/^Next: Press Try again/);
    expect(rows[5]).toBe('Request id: none');
    expect(rows[6]).toBe('Envelope:');
    expect(JSON.parse(rows[7])).toMatchObject({ code: 'render_failed', requestId: null, details: { component: 'Broken' } });
    expect(rows[8]).toBe('Last 50 log lines:');
    expect(rows.slice(9)).toEqual(lines);
  });

  it('keeps only the newest 50 lines', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
    const rows = buildDetails({ envelope, path: '/apps', logLines: lines, now: NOW }).split('\n');
    expect(rows.slice(-50)[0]).toBe('line 30');
    expect(rows.at(-1)).toBe('line 79');
  });

  it('says so when the log lines could not be read', () => {
    const text = buildDetails({ envelope, path: '/apps', logLines: null, now: NOW });
    expect(text.endsWith(SURFACE_COPY.detailsLogsFailed)).toBe(true);
  });

  it('redacts a home folder in the path', () => {
    const text = buildDetails({ envelope, path: `${WIN_HOME}\\x`, logLines: [], now: NOW });
    expect(text).not.toContain('sam');
  });
});

describe('fetchLogLines', () => {
  it('reads the lines', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { lines: ['a', { level: 'warn' }] } })));
    await expect(fetchLogLines(fetchImpl as unknown as typeof fetch)).resolves.toEqual(['a', '{"level":"warn"}']);
    expect(fetchImpl).toHaveBeenCalledWith('/api/studio/diagnostics/logs?limit=50&level=debug', { signal: expect.any(AbortSignal) });
  });

  it('is null when the call fails or answers an error', async () => {
    await expect(
      fetchLogLines(
        asFetch(async () => {
          throw new TypeError('Failed to fetch');
        }),
      ),
    ).resolves.toBeNull();
    await expect(fetchLogLines(asFetch(async () => new Response('{}', { status: 404 })))).resolves.toBeNull();
  });
});
