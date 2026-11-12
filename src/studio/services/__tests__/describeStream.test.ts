import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DescribeEvent } from '../../types';
import { runDescribeStream } from '../describeStream';

afterEach(() => vi.unstubAllGlobals());

async function messages(pageTitles?: Record<string, string>): Promise<string[]> {
  const body =
    'event: progress\ndata: {"step":"page","pageId":"crew","round":1,"status":"running"}\n\n' +
    'event: progress\ndata: {"step":"page","pageId":"new-page","round":1,"status":"running"}\n\n';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
  const seen: DescribeEvent[] = [];
  await runDescribeStream({ appId: 'a1', mode: 'edit', instruction: 'x', baseRevision: 1, pageTitles, onEvent: (e) => seen.push(e) });
  return seen.flatMap((e) => (e.type === 'progress' ? [e.message] : []));
}

describe('runDescribeStream progress labels', () => {
  it('shows the page title when known and the id otherwise', async () => {
    expect(await messages({ crew: 'Crew List' })).toEqual(['Designing the page "Crew List"', 'Designing the page "new-page"']);
  });

  it('prefers the title sent by the server and ignores inherited keys of the workspace map', async () => {
    const body =
      'event: progress\ndata: {"step":"page","pageId":"crew","title":"From Server","round":0,"status":"running"}\n\n' +
      'event: progress\ndata: {"step":"page","pageId":"constructor","round":0,"status":"running"}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const seen: DescribeEvent[] = [];
    await runDescribeStream({ appId: 'a1', mode: 'create', instruction: 'x', baseRevision: 1, pageTitles: { crew: 'Old' }, onEvent: (e) => seen.push(e) });
    expect(seen.flatMap((e) => (e.type === 'progress' ? [e.message] : []))).toEqual(['Designing the page "From Server"', 'Designing the page "constructor"']);
  });

  it('falls back to the id without titles', async () => {
    expect(await messages()).toEqual(['Designing the page "crew"', 'Designing the page "new-page"']);
  });
});
