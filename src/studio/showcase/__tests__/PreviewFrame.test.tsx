import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import { recordOf } from '../../components/__tests__/featureFixtures';
import { buildShowcaseEntries } from '../entries';
import PreviewFrame from '../PreviewFrame';
import { previewModelFor, sampleBackedRows, showcaseRows } from '../samples';

const library = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const entries = buildShowcaseEntries(SEED_FEATURES.map((d) => recordOf(d)));
afterEach(cleanup);

describe('every entry has a preview', () => {
  it.each(entries.map((e) => [e.key, e] as const))('draws %s from sample rows', async (_key, entry) => {
    expect(previewModelFor(entry, library)).not.toBeNull();
    render(<PreviewFrame entry={entry} library={library} size="md" />);
    const content = await screen.findByTestId('scale-content');
    await waitFor(() => expect(content.querySelector('[data-layer-id]')).not.toBeNull());
    expect(screen.queryByText('This preview could not be shown.')).toBeNull();
    expect(screen.queryByText('This part could not be shown.')).toBeNull();
  });

  it('says so, and nothing else, for a broken feature', () => {
    const entry = buildShowcaseEntries([recordOf(SEED_FEATURES[0], { ok: false, fragment: null })]).slice(-1)[0];
    render(<PreviewFrame entry={entry} library={library} size="sm" />);
    expect(screen.getByText('This preview could not be shown.')).toBeTruthy();
  });
});

describe('theme', () => {
  const theme = { preset: 'aurora', radius: 'md', id: 'midnight' } as const;

  it('wraps the preview in a theme scope when a theme is given', async () => {
    render(<PreviewFrame entry={entries[0]} library={library} size="md" theme={theme} />);
    const content = await screen.findByTestId('scale-content');
    const scope = content.closest('[data-theme-mode]');
    expect(scope).not.toBeNull();
    expect(scope?.getAttribute('data-theme-mode')).toBe('dark');
    expect((scope as HTMLElement).style.getPropertyValue('--radius-md')).toBe('0.5rem');
  });

  it('shows a Classic theme (no mode) in light', async () => {
    render(<PreviewFrame entry={entries[0]} library={library} size="md" theme={{ preset: 'aurora', radius: 'md' }} />);
    const content = await screen.findByTestId('scale-content');
    expect(content.closest('[data-theme-mode]')?.getAttribute('data-theme-mode')).toBe('light');
  });

  it('adds no scope without a theme', async () => {
    render(<PreviewFrame entry={entries[0]} library={library} size="md" />);
    const content = await screen.findByTestId('scale-content');
    expect(content.closest('[data-theme-mode]')).toBeNull();
  });
});

describe('sample data', () => {
  it('is memoized and deterministic', () => {
    const entry = entries.find((e) => e.id === 'DataTable');
    expect(entry).toBeDefined();
    if (!entry) return;
    const model = previewModelFor(entry, library);
    expect(model).toBe(previewModelFor(entry, library));
    expect(model?.data.spec).toBeDefined();
    if (model?.data.spec) expect(JSON.stringify(showcaseRows(model.data.spec))).toBe(JSON.stringify(showcaseRows(model.data.spec)));
  });

  it('points reference fields at rows of the referenced table and sets a record id', () => {
    const entry = entries.find((e) => e.id === 'RecordDetail');
    const model = entry ? previewModelFor(entry, library) : null;
    expect(model?.data.recordId).toBe('crews_1');
    const rows = model?.data.spec ? showcaseRows(model.data.spec) : {};
    expect(rows.crews.map((r) => r.lead_id)).toEqual(['people_1', 'people_2', 'people_3', 'people_4', 'people_5']);
  });
});

describe('sampleBackedRows', () => {
  const spec = () => {
    const entry = entries.find((e) => e.id === 'RecordDetail');
    const model = entry ? previewModelFor(entry, library) : null;
    if (!model?.data.spec) throw new Error('no spec');
    return model.data.spec;
  };

  it('is the made-up rows without a sample', () => {
    expect(sampleBackedRows(spec(), null)).toEqual(showcaseRows(spec()));
  });

  it('replaces the tables the sample covers, with ids table_n, dates around today and links resolved', () => {
    const s = spec();
    const today = new Date(2026, 5, 15);
    const rows = sampleBackedRows(s, { v: 1, tables: { people: [{ _id: 'a', name: 'Mara Quill' }, { name: 'Joss Hale' }] } }, today);
    expect(rows.people.map((r) => [r.id, r.name])).toEqual([['people_1', 'Mara Quill'], ['people_2', 'Joss Hale']]);
    expect(rows.crews).toEqual(showcaseRows(s).crews);
    const linked = sampleBackedRows(s, { v: 1, tables: { people: [{ _id: 'a', name: 'Mara Quill' }], crews: [{ name: 'North', lead_id: 'a' }, { name: 'South', lead_id: 'zzz' }] } }, today);
    expect(linked.crews.map((r) => [r.id, r.lead_id])).toEqual([['crews_1', 'people_1'], ['crews_2', undefined]]);
  });
});

describe('only frames in view mount their preview', () => {
  it('waits for the observer', async () => {
    const observers: Array<{ cb: IntersectionObserverCallback; el: Element }> = [];
    class FakeIO {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element): void {
        observers.push({ cb: this.cb, el });
      }
      disconnect(): void {}
    }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    try {
      render(<PreviewFrame entry={entries[0]} library={library} size="sm" />);
      expect(screen.getByTestId('preview-frame').getAttribute('data-in-view')).toBe('false');
      expect(screen.queryByTestId('scale-content')).toBeNull();
      act(() => observers[0].cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(await screen.findByTestId('scale-content')).toBeTruthy();
    } finally {
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    }
  });
});
