// Keyboard focus after Alt+Arrow re-sorts the wrappers of a free Grid (review fix, DESIGN-phase21.md 6.5): the keyed wrappers move in
// the DOM at every width, so the browser drops focus, and the session puts it back on the moved block (wide and narrow).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { libraryOf } from '../../hooks/useFeatures';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import DesignSession from '../DesignSession';
import { at, freeGrid, page, text } from './gridFixtures';

vi.mock('@local-app-studio/runtime/runtime/dataClient.js', () => ({ createHttpDataSource: () => ({}) }));
const metrics = vi.hoisted(() => ({ narrow: false }));
vi.mock('../gridMetrics', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gridMetrics')>();
  return { ...real, narrowGrid: () => metrics.narrow };
});

const features = seedRecords();
const library = libraryOf(features);

const specOf = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [{ id: 'home', title: 'Home', route: '/', sources: [], layout: page(freeGrid('g', [text('a', at(1, 4, 1, 1)), text('b', at(5, 4, 1, 1))], 2)) }],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

function mount(): void {
  const spec = specOf();
  render(
    <MemoryRouter>
      <DesignSession
        spec={spec}
        revision={0}
        page={spec.pages[0]}
        pageIndex={0}
        appId="app-1"
        onShowPage={() => {}}
        features={features}
        library={library}
        reloadFeatures={async () => {}}
        liveSource={undefined}
        onDirty={() => {}}
        onDraft={() => {}}
        onStale={() => {}}
        save={async () => ({ ok: false, code: 'error', message: 'unused', issues: [] })}
        initialTab="features"
        addEntryKey={null}
        toolbarStart={<span>Start</span>}
      />
    </MemoryRouter>,
  );
}

const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (el === null) throw new Error(`no block ${id}`);
  return el;
};
const order = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-grid-item]')].map((el) => el.dataset.gridItem ?? '');

beforeAll(async () => {
  await import('../NewTableDialog');
  await import('../AddFieldDialog');
});
beforeEach(() => {
  metrics.narrow = false;
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('focus after Alt+Arrow re-sorts a free Grid', () => {
  for (const [label, narrow] of [['wide', false], ['narrow', true]] as const) {
    it(`${label}: the moved block keeps the keyboard focus when the reading order changes`, async () => {
      metrics.narrow = narrow;
      mount();
      await screen.findByTestId('design-canvas');
      expect(order()).toEqual(['a', 'b']);
      const a = block('a');
      act(() => a.focus());
      expect(document.activeElement).toBe(a);
      // a at column 1 row 1 goes down to row 2: after b in reading order.
      await act(async () => {
        fireEvent.keyDown(a, { key: 'ArrowDown', altKey: true });
      });
      expect(order()).toEqual(['b', 'a']);
      expect(document.activeElement).toBe(block('a'));
    });
  }
});
