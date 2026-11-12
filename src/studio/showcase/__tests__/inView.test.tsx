import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import { recordOf } from '../../components/__tests__/featureFixtures';
import { buildShowcaseEntries } from '../entries';
import FeatureTile from '../FeatureTile';

afterEach(() => {
  cleanup();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('previews of a long list', () => {
  it('mounts only the previews that are near the viewport, and keeps them mounted', async () => {
    const watchers: Array<{ el: Element; cb: IntersectionObserverCallback }> = [];
    class FakeIO {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element): void {
        watchers.push({ el, cb: this.cb });
      }
      disconnect(): void {}
    }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;

    const records = Array.from({ length: 50 }, (_, i) => recordOf({ ...SEED_FEATURES[i % 2], id: `feature_${i}`, label: `Feature ${i}` }));
    const entries = buildShowcaseEntries(records);
    expect(entries).toHaveLength(50 + 31);
    const library = new Map(SEED_FEATURES.map((d) => [d.id, d]));
    render(
      <ul>
        {entries.map((e) => (
          <FeatureTile key={e.key} entry={e} library={library} size="md" onOpen={vi.fn()} actions={[]} />
        ))}
      </ul>,
    );
    await waitFor(() => expect(watchers).toHaveLength(81));
    expect(screen.queryAllByTestId('scale-content')).toHaveLength(0);

    const near = watchers.slice(0, 4);
    act(() => near.forEach((w) => w.cb([{ isIntersecting: true, target: w.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)));
    await waitFor(() => expect(screen.queryAllByTestId('scale-content')).toHaveLength(4));
    expect(screen.getAllByTestId('preview-frame').filter((f) => f.getAttribute('data-in-view') === 'true')).toHaveLength(4);
  });
});
