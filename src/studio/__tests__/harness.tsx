import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import AppWorkspace from '../pages/AppWorkspace';
import { json } from './fixtures';
import type { AppRecord } from '../types';

export const APP_ID = '11111111-1111-4111-8111-111111111111';

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Mocks fetch: GET of the app returns `record()`, every other request goes to `other` (default 404). */
export function mockWorkspaceFetch(record: () => AppRecord, other?: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { url, method, body };
    calls.push(call);
    if (method === 'GET' && url === `/api/studio/apps/${APP_ID}`) return json(200, { data: record() });
    return other ? other(call) : json(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export function renderWorkspace(path: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP_ID}/${path}`]}>
      <Routes>
        <Route path="/apps" element={<p>Apps list</p>} />
        <Route path="/apps/:appId/*" element={<AppWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );
}
