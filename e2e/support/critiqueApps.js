// Set-up helpers for the phase 14 proof flows (critique*.spec.js): apps made through the Studio API, so the flow itself only
// does what the fix is about.
import fs from 'node:fs';
import { expect } from './fixtures.js';

export const crewRosterSpec = () => JSON.parse(fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));

/** Imports the Crew Roster fixture (two tables, so a new data part is not connected by itself) and returns its record. */
export async function importCrewRoster(request, name = 'Crew Roster') {
  const spec = crewRosterSpec();
  spec.app.name = name;
  const res = await request.post('/api/studio/apps/import', { data: { spec } });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

/** Creates a blank app, lets `mutate(spec)` change its spec, saves it, and returns the saved record. */
export async function makeApp(request, name, mutate) {
  const created = await request.post('/api/studio/apps', { data: { name } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const spec = structuredClone(record.spec);
  mutate(spec);
  const put = await request.put(`/api/studio/apps/${record.id}`, { data: { spec, baseRevision: record.revision } });
  expect(put.status()).toBe(200);
  return (await put.json()).data;
}

export const getApp = async (request, id) => (await (await request.get(`/api/studio/apps/${id}`)).json()).data;
export const listApps = async (request) => (await (await request.get('/api/studio/apps')).json()).data;

export const CREWS_TABLES = [
  { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
  {
    id: 'crews',
    label: 'Crews',
    titleField: 'name',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'status', label: 'Status', type: 'select', options: ['open', 'closed'], default: 'open' },
    ],
  },
];
