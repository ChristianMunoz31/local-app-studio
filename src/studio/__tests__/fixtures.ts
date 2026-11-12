import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppRecord } from '../types';

export const baseSpec = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'size', label: 'Size', type: 'integer', required: false },
        { id: 'status', label: 'Status', type: 'select', required: false, options: ['active', 'paused'] },
      ],
    },
  ],
  pages: [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      sources: [],
      layout: { id: 'root_home', type: 'Page', props: {}, children: [{ id: 'heading_1', type: 'Heading', props: { size: 'lg' }, children: 'Crew Roster' }] },
    },
  ],
  nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

export const recordOf = (spec: AppSpec | null, extra: Partial<AppRecord> = {}): AppRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Crew Roster',
  slug: 'crew-roster',
  revision: 3,
  spec,
  issues: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
