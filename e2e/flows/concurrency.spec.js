// Concurrency (design 2.6, A6.1 to A6.4): two windows on one app, Save during Preview start, Build during Save, and Save
// after a delete. The server answers a stale Save with 409 revision_conflict (no last write wins); the second window shows a
// plain message and nothing the first window saved is lost. Each test makes its own app. Nothing leaves this computer.
import { test, expect, useApp } from '../support/fixtures.js';
import { addDivider, blockOrder, createApp, headerStatus, openDesignOf, openWindow, pressSave, savedChildIds } from '../support/twoContexts.js';
import { skipWithoutPro } from '../support/proBuild.js';

// Seeded so the first-run welcome dialog (profile.onboardedAt) does not cover the Design canvas in the extra windows.
const ctx = useApp({ seed: true, ollama: 'dead' });

const CONFLICT_UI =
  'This app changed in another window, so your change was not saved. The newer version is already loaded behind your edits, and your edits stay here until you leave. To keep both, note your change and make it again.';
const CONFLICT_API = 'This app changed in another window. Reload it and try again.';
const GONE = 'That app does not exist. It may have been deleted.';

/** @param {import('@playwright/test').APIRequestContext} request @param {string} id */
const getApp = async (request, id) => (await (await request.get(`/api/studio/apps/${id}`)).json()).data;

const withHeading = (spec, text) => {
  const copy = structuredClone(spec);
  copy.pages[0].layout.children[0].children = text;
  return copy;
};

test('A6.1 the second window returns to the latest page, nothing is half saved and the first window save survives', async ({ browser, request }) => {
  // The browser logs a 409 as a console error; that is the only one allowed.
  test.info().annotations.push({ type: 'allow-console-errors', description: '409' });
  const app = await createApp(request, 'Crew Alpha');
  const a = await openWindow(browser, ctx.server);
  const b = await openWindow(browser, ctx.server);
  try {
    await openDesignOf(a.page, app.id);
    await openDesignOf(b.page, app.id);

    await addDivider(a.page, 'Add here: Page, place 2');
    await pressSave(a.page);
    await expect(headerStatus(a.page).filter({ hasText: /^All changes saved$/ })).toBeVisible();
    const afterA = await savedChildIds(request, app.id);
    expect(afterA.revision).toBe(app.revision + 1);
    expect(afterA.ids).toEqual(['heading_a', 'divider_1', 'text_a']);

    // B still holds the old revision and changes something else.
    await addDivider(b.page, 'Add here: Page, place 3');
    await expect(b.page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    const refused = b.page.waitForResponse((r) => r.url().includes(`/api/studio/apps/${app.id}`) && r.request().method() === 'PUT');
    await pressSave(b.page);
    expect((await refused).status()).toBe(409);
    // The window says so in plain words and keeps B's unsaved divider on screen (a draft with edits never adopts the other
    // change); the header still counts the change as unsaved and nothing is half applied.
    await expect(b.page.getByText(CONFLICT_UI)).toBeVisible();
    await expect(b.page.locator('[data-canvas-block]')).toHaveCount(4);
    await expect(headerStatus(b.page)).toHaveText('Unsaved changes on Design');

    // Nothing was written by B, and A's change is still the saved one.
    expect(await savedChildIds(request, app.id)).toEqual(afterA);

    // After B reloads, A's change is there and B can work again from the latest revision.
    await b.page.reload();
    await expect(b.page.locator('[data-canvas-block][data-layer-id="divider_1"]')).toBeVisible();
    expect((await blockOrder(b.page)).slice(1)).toEqual(['heading_a', 'divider_1', 'text_a']);
    await addDivider(b.page, 'Add here: Page, place 4');
    await pressSave(b.page);
    await expect(headerStatus(b.page).filter({ hasText: /^All changes saved$/ })).toBeVisible();
    const afterB = await savedChildIds(request, app.id);
    expect(afterB.revision).toBe(app.revision + 2);
    expect(afterB.ids).toHaveLength(4);
    expect(afterB.ids.slice(0, 3)).toEqual(['heading_a', 'divider_1', 'text_a']);

    expect(a.blocked).toEqual([]);
    expect(b.blocked).toEqual([]);
    expect(a.consoleErrors).toEqual([]);
    expect(b.consoleErrors.every((e) => /409/.test(e))).toBe(true);
  } finally {
    await a.close();
    await b.close();
  }
});

test('A6.1 the second window is told, in plain words, that its change was not saved', async ({ browser, request }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '409' });
  const app = await createApp(request, 'Crew Zeta');
  const a = await openWindow(browser, ctx.server);
  const b = await openWindow(browser, ctx.server);
  try {
    await openDesignOf(a.page, app.id);
    await openDesignOf(b.page, app.id);
    await addDivider(a.page, 'Add here: Page, place 2');
    await pressSave(a.page);
    await expect(headerStatus(a.page).filter({ hasText: /^All changes saved$/ })).toBeVisible();
    await addDivider(b.page, 'Add here: Page, place 3');
    await pressSave(b.page);
    await expect(b.page.getByText(CONFLICT_UI)).toBeVisible({ timeout: 3000 });
  } finally {
    await a.close();
    await b.close();
  }
});

test('A6.1 two saves of the same revision sent together: exactly one lands, the other is a plain 409', async ({ request }) => {
  const app = await createApp(request, 'Crew Beta');
  const send = (text) => request.put(`/api/studio/apps/${app.id}`, { data: { spec: withHeading(app.spec, text), baseRevision: app.revision } });
  const [one, two] = await Promise.all([send('Heading one'), send('Heading two')]);
  expect([one.status(), two.status()].sort()).toEqual([200, 409]);
  const body = await [one, two].find((r) => r.status() === 409).json();
  expect(body.code).toBe('revision_conflict');
  expect(body.message).toBe(CONFLICT_API);
  const saved = (await [one, two].find((r) => r.status() === 200).json()).data;
  const now = await getApp(request, app.id);
  expect(now.revision).toBe(app.revision + 1);
  expect(now.spec.pages[0].layout.children[0].children).toBe(saved.spec.pages[0].layout.children[0].children);
});

test('A6.2 Save during Preview start: the preview ends up on the saved revision and never shows the old one as running', async ({ request }) => {
  const app = await createApp(request, 'Crew Gamma');
  const runningAt = async (revision, seen) => {
    const s = (await (await request.get('/api/studio/preview/status')).json()).data;
    seen.push(s);
    return s.state === 'running' && s.revision === revision;
  };

  // A cold start and a save sent together.
  const [started, saved] = await Promise.all([
    request.post('/api/studio/preview/start', { data: { appId: app.id } }),
    request.put(`/api/studio/apps/${app.id}`, { data: { spec: withHeading(app.spec, 'Saved while starting'), baseRevision: app.revision } }),
  ]);
  expect(saved.status()).toBe(200);
  expect(started.status()).toBe(200);
  const next = (await saved.json()).data.revision;
  expect(next).toBe(app.revision + 1);
  const seen = [];
  await expect.poll(() => runningAt(next, seen), { timeout: 30_000 }).toBe(true);
  expect(seen.filter((s) => s.state === 'running' && s.revision !== next)).toEqual([]);

  // Already running: another save restarts it at the new revision.
  const again = await request.put(`/api/studio/apps/${app.id}`, { data: { spec: withHeading(app.spec, 'Saved while running'), baseRevision: next } });
  expect(again.status()).toBe(200);
  const last = (await again.json()).data.revision;
  const afterSave = [];
  await expect.poll(() => runningAt(last, afterSave), { timeout: 30_000 }).toBe(true);
  expect(afterSave.filter((s) => s.state === 'running' && s.revision !== last)).toEqual([]);
  expect((await (await request.post('/api/studio/preview/stop')).json()).data.state).toBe('stopped');
});

test('A6.3 Build during Save: the build keeps its revision, Save is not blocked, a stale build request is refused', { tag: '@pro' }, async ({ request }) => {
  skipWithoutPro(test, 'the installer is not in a public build');
  const app = await createApp(request, 'Crew Delta');
  const toolchain = (await (await request.get('/api/studio/build/toolchain?refresh=1')).json()).data;
  // A machine with the full toolchain would run npm and cargo for real. This spec never does that.
  test.skip(toolchain.ok, 'The build tools are installed here: a real build would install packages and compile, so only a sandbox without them is exercised.');

  // Builds are an opt-in network feature; the build itself stops at its first step here.
  const optIn = await request.put('/api/settings/network', { data: { id: 'build', enabled: true } });
  expect(optIn.status()).toBe(200);

  const [build, save] = await Promise.all([
    request.post(`/api/studio/apps/${app.id}/builds`, { data: { baseRevision: app.revision } }),
    request.put(`/api/studio/apps/${app.id}`, { data: { spec: withHeading(app.spec, 'Saved during the build'), baseRevision: app.revision } }),
  ]);
  // The save always lands. The build either began at revision r, or reached the server after the save and was refused as stale.
  expect(save.status()).toBe(200);
  expect((await save.json()).data.revision).toBe(app.revision + 1);
  if (build.status() === 201) {
    const started = (await build.json()).data;
    expect(started.specRevision).toBe(app.revision);
    let finished;
    await expect
      .poll(
        async () => {
          finished = (await (await request.get(`/api/studio/builds/${started.id}`)).json()).data;
          return finished.status;
        },
        { timeout: 30_000 },
      )
      .not.toBe('running');
    expect(finished.status).toBe('failed');
    expect(finished.errorCode).toBe('toolchain_missing');
    expect(finished.message).toBe('Some build tools are missing. Install them as listed above, then build again.');
    expect(finished.specRevision).toBe(app.revision);
  } else {
    expect(build.status()).toBe(409);
    expect((await build.json()).code).toBe('revision_conflict');
  }
  const now = await getApp(request, app.id);
  expect(now.revision).toBe(app.revision + 1);
  expect(now.spec.pages[0].layout.children[0].children).toBe('Saved during the build');

  // A build asked for with the old revision is refused with the plain conflict, and no build row is added for it.
  const rows = async () => (await (await request.get(`/api/studio/apps/${app.id}/builds`)).json()).data.length;
  const before = await rows();
  const stale = await request.post(`/api/studio/apps/${app.id}/builds`, { data: { baseRevision: app.revision } });
  expect(stale.status()).toBe(409);
  const staleBody = await stale.json();
  expect(staleBody.code).toBe('revision_conflict');
  expect(staleBody.message).toBe(CONFLICT_API);
  expect(await rows()).toBe(before);
});

test('A6.4 the app is deleted while another window is in Design: Save answers that the app does not exist', async ({ browser, request }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '404' });
  const app = await createApp(request, 'Crew Epsilon');
  const a = await openWindow(browser, ctx.server);
  const b = await openWindow(browser, ctx.server);
  try {
    await openDesignOf(b.page, app.id);
    await addDivider(b.page, 'Add here: Page, place 2');
    await expect(b.page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

    // Window A deletes the app (the request the Delete button sends).
    expect((await a.page.request.delete(`/api/studio/apps/${app.id}`)).status()).toBe(200);

    const refused = b.page.waitForResponse((r) => r.url().includes(`/api/studio/apps/${app.id}`) && r.request().method() === 'PUT');
    await pressSave(b.page);
    const res = await refused;
    expect(res.status()).toBe(404);
    expect((await res.json()).message).toBe(GONE);
    await expect(b.page.getByRole('alert').filter({ hasText: GONE })).toBeVisible();
    // The failed save does not bring the app back.
    expect((await request.get(`/api/studio/apps/${app.id}`)).status()).toBe(404);
    expect(b.blocked).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
