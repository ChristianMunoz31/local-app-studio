// A Chart over seeded rows in Preview: three crews (two active, one paused) grouped by Status show their counts in the
// chart's table for screen readers. The numbers come from the server (GET /api/preview/data/crews/stats?groupBy=status).
import { test, expect, useApp } from '../support/fixtures.js';

useApp({ seed: true, ollama: 'dead' });

test.describe.configure({ mode: 'serial' });

test('a chart grouped by status shows active 2 and paused 1 in Preview', async ({ page, request, baseURL }) => {
  const created = await (await page.request.post('/api/studio/apps', { data: { name: 'Crew Roster' } })).json();
  const record = created.data;
  const spec = record.spec;
  spec.tables = [
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', required: false, type: 'text' },
        { id: 'status', label: 'Status', required: false, type: 'select', options: ['active', 'paused'] },
      ],
    },
  ];
  spec.pages[0].sources = [{ id: 'all_crews', table: 'crews', mode: 'list' }];
  spec.pages[0].layout = {
    ...spec.pages[0].layout,
    children: [{ id: 'chart_a', type: 'Chart', props: { source: 'all_crews', groupBy: 'status', measure: 'count', title: 'Crews by status' }, children: [] }],
  };
  const put = await page.request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);

  await page.goto('/apps');
  await page.getByRole('link', { name: 'Crew Roster' }).click();
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('link', { name: 'Preview' }).click();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });

  for (const row of [
    { name: 'Alpha', status: 'active' },
    { name: 'Beta', status: 'active' },
    { name: 'Gamma', status: 'paused' },
  ]) {
    const res = await request.post(`${baseURL}/api/preview/data/crews`, { data: row });
    expect(res.status()).toBe(201);
  }
  const stats = await request.get(`${baseURL}/api/preview/data/crews/stats?groupBy=status`);
  expect(stats.status()).toBe(200);
  expect((await stats.json()).data.groups).toEqual([
    { key: 'active', count: 2, value: 2 },
    { key: 'paused', count: 1, value: 1 },
  ]);

  await page.reload();
  await expect(page.getByText('Your app is running.')).toBeVisible({ timeout: 30_000 });
  const figure = page.getByRole('figure').filter({ hasText: 'Crews by status' });
  await expect(figure.getByRole('img', { name: 'Crews by status' })).toBeVisible();
  const rows = figure.getByRole('row');
  await expect(rows.filter({ hasText: /^active\s*2$/ })).toHaveCount(1);
  await expect(rows.filter({ hasText: /^paused\s*1$/ })).toHaveCount(1);
});
