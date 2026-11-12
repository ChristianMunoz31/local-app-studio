// Helpers for the concurrency spec: two browser windows (contexts) on one sandboxed server, an app with a known page, and the
// Design steps both windows repeat. Each window keeps the same guards as the shared `page` fixture: nothing but the server's
// own origin may be reached, and console errors are collected so a test can assert on them.
import { expect } from './fixtures.js';

/**
 * Opens one more browser window (a separate context: its own storage and in-memory state) on the server.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ url: string }} server
 */
export async function openWindow(browser, server) {
  const context = await browser.newContext({
    baseURL: server.url,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const origin = new URL(server.url).origin;
  const blocked = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:') || new URL(url).origin === origin) return route.fallback();
    blocked.push(`${route.request().method()} ${url}`);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return { context, page, consoleErrors, blocked, close: () => context.close() };
}

/**
 * Creates an app with a heading and a text part on its first page and returns the saved record.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} name
 */
export async function createApp(request, name) {
  const created = await request.post('/api/studio/apps', { data: { name } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = record.spec;
  const root = spec.pages[0].layout;
  spec.pages[0].layout = {
    ...root,
    children: [
      { id: 'heading_a', type: 'Heading', props: { size: 'lg' }, children: name },
      { id: 'text_a', type: 'Text', props: {}, children: 'Who is on which crew.' },
    ],
  };
  const put = await request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);
  return (await put.json()).data;
}

/** Opens the Design step of an app by URL and waits for the canvas. */
export async function openDesignOf(page, appId) {
  await page.goto(`/apps/${appId}/design`);
  await expect(page.getByRole('region', { name: 'Page layout' })).toBeVisible();
  await expect(page.locator('[data-canvas-block][data-layer-id="heading_a"]')).toBeVisible();
}

/** Adds a Divider line at a place with the keyboard (Add here, then the tile), as a person without a mouse would. */
export async function addDivider(page, zoneName) {
  await page.getByRole('button', { name: zoneName }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add Divider line' }).click();
}

/** Presses Save. */
export const pressSave = (page) => page.getByRole('button', { name: 'Save', exact: true }).click();

/** The save line in the header of the workspace: "All changes saved", "Unsaved changes on Design" or "Saving...". */
export const headerStatus = (page) => page.getByTestId('save-status');

/** The ids of the blocks on the canvas, in document order. */
export const blockOrder = (page) => page.locator('[data-canvas-block]').evaluateAll((els) => els.map((el) => el.dataset.layerId));

/** The revision and the ids of the first page's top-level parts, read from the server. */
export async function savedChildIds(request, appId) {
  const record = (await (await request.get(`/api/studio/apps/${appId}`)).json()).data;
  return { revision: record.revision, ids: record.spec.pages[0].layout.children.map((c) => c.id) };
}
