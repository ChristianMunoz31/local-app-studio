// Backend page allowlist and caps must stay identical to the frontend catalogue.
import { afterEach, describe, it, expect, vi } from 'vitest';
import * as server from '../assistant/pages.js';
import * as client from '../../src/constants/assistantPages.js';

describe('assistant page parity (frontend vs backend)', () => {
  it('has identical page keys', () => {
    expect([...client.ASSISTANT_PAGE_KEYS].sort()).toEqual(Object.keys(server.ASSISTANT_PAGE_LABELS).sort());
  });

  it('has identical labels', () => {
    for (const key of client.ASSISTANT_PAGE_KEYS) {
      expect(client.ASSISTANT_PAGES[key].label).toBe(server.ASSISTANT_PAGE_LABELS[key]);
    }
  });

  it('has equal size caps', () => {
    expect(client.ASSISTANT_CONTEXT_MAX_CHARS).toBe(server.ASSISTANT_CONTEXT_MAX_CHARS);
    expect(client.ASSISTANT_MAX_MESSAGES).toBe(server.ASSISTANT_MAX_MESSAGES);
    expect(client.ASSISTANT_MAX_MESSAGE_CHARS).toBe(server.ASSISTANT_MAX_MESSAGE_CHARS);
    expect(client.ASSISTANT_MAX_TOTAL_MESSAGE_CHARS).toBe(server.ASSISTANT_MAX_TOTAL_MESSAGE_CHARS);
    expect(server.ASSISTANT_MAX_TOTAL_MESSAGE_CHARS).toBe(16000);
  });
});

describe('assistant page parity in a runtime build', () => {
  const savedMode = process.env.APP_MODE;
  afterEach(() => {
    if (savedMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = savedMode;
    vi.doUnmock('../../src/appMode.js');
    vi.resetModules();
  });

  it('leaves the kit Home and Items out on both sides, with identical keys and labels', async () => {
    vi.resetModules();
    process.env.APP_MODE = 'runtime';
    vi.doMock('../../src/appMode.js', () => ({ APP_MODE: 'runtime' }));
    const runtimeServer = await import('../assistant/pages.js');
    const runtimeClient = await import('../../src/constants/assistantPages.js');
    expect([...runtimeClient.ASSISTANT_PAGE_KEYS].sort()).toEqual(Object.keys(runtimeServer.ASSISTANT_PAGE_LABELS).sort());
    expect(runtimeServer.isAssistantPage('home')).toBe(false);
    expect(runtimeServer.isAssistantPage('items')).toBe(false);
    expect(runtimeServer.isAssistantPage('app')).toBe(true);
    expect(runtimeServer.isAssistantPage('settings')).toBe(true);
    for (const key of runtimeClient.ASSISTANT_PAGE_KEYS) {
      expect(runtimeClient.ASSISTANT_PAGES[key].label).toBe(runtimeServer.ASSISTANT_PAGE_LABELS[key]);
    }
  });
});
