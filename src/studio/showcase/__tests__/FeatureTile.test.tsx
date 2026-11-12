import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import { recordOf } from '../../components/__tests__/featureFixtures';
import { buildShowcaseEntries } from '../entries';
import FeatureTile from '../FeatureTile';
import type { TileAction } from '../FeatureTile';

vi.mock('../PreviewFrame', () => ({ default: () => <div data-testid="preview-stub" /> }));

afterEach(cleanup);
const library = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const noParams = recordOf({ ...SEED_FEATURES[0], params: [], bindings: [] });
const entries = buildShowcaseEntries([noParams, recordOf(SEED_FEATURES[1])]);
const part = entries.find((e) => e.id === 'StatCard');
const custom = entries.find((e) => e.kind === 'feature' && e.params.length === 0);
const withParams = entries.find((e) => e.kind === 'feature' && e.params.length > 0);
const actions = (): TileAction[] => [
  { id: 'details', label: 'Details', onSelect: vi.fn() },
  { id: 'use', label: 'Use in app', onSelect: vi.fn() },
];

function shape(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('button, [role="status"], [data-testid]')).map((n) => `${n.tagName}:${n.getAttribute('data-testid') ?? ''}`);
}

describe('FeatureTile', () => {
  it('has the same structure for a built-in part and a saved feature', () => {
    if (!part || !custom) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={part} library={library} size="md" onOpen={vi.fn()} actions={actions()} />
        <FeatureTile entry={custom} library={library} size="md" onOpen={vi.fn()} actions={actions()} />
      </ul>,
    );
    const [a, b] = screen.getAllByTestId('feature-tile');
    expect(shape(a)).toEqual(shape(b));
    expect(a.className).toBe(b.className);
    expect(within(a).getByText('Records')).toBeTruthy();
    expect(within(b).getByText('Your features')).toBeTruthy();
    expect(within(a).getAllByRole('button').map((n) => n.tagName)).toEqual(within(b).getAllByRole('button').map((n) => n.tagName));
  });

  it('shows a settings chip per setting', () => {
    if (!withParams) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={withParams} library={library} size="md" onOpen={vi.fn()} actions={actions()} />
      </ul>,
    );
    for (const p of withParams.params) expect(screen.getByText(`${p.label}: ${p.words}`)).toBeTruthy();
  });

  it('opens from the body button with its default name, and from a custom name', () => {
    if (!part) throw new Error('fixtures');
    const onOpen = vi.fn();
    const { rerender } = render(
      <ul>
        <FeatureTile entry={part} library={library} size="md" onOpen={onOpen} actions={actions()} />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show details for Number tile' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(
      <ul>
        <FeatureTile entry={part} library={library} size="sm" openLabel="Choose Number tile" onOpen={onOpen} actions={actions()} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: 'Choose Number tile' })).toBeTruthy();
  });

  it('is reachable by keyboard: body button, then menu, with a visible focus ring and a hover style', () => {
    if (!part) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={part} library={library} size="md" onOpen={vi.fn()} actions={actions()} footer={<button type="button">Add</button>} />
      </ul>,
    );
    const body = screen.getByRole('button', { name: 'Show details for Number tile' });
    expect(body.className).toContain('focus-visible:after:ring-2');
    expect(body.className).toContain('focus-visible:after:ring-slate-brandLight');
    expect(screen.getByTestId('feature-tile').className).toContain('glass-hover');
    const order = screen.getAllByRole('button').map((n) => n.getAttribute('aria-label') ?? n.textContent);
    expect(order).toEqual(['Show details for Number tile', 'More actions for Number tile', 'Add']);
    expect(body.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'More actions for Number tile' }).getAttribute('tabindex')).not.toBe('-1');
  });

  it('keeps the preview out of the body button and lets a click on it reach the tile (stretched button)', () => {
    if (!part) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={part} library={library} size="md" onOpen={vi.fn()} actions={actions()} />
      </ul>,
    );
    const body = screen.getByRole('button', { name: 'Show details for Number tile' });
    const stub = screen.getByTestId('preview-stub');
    expect(within(body).queryByTestId('preview-stub')).toBeNull();
    expect(body.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull();
    const wrap = stub.parentElement as HTMLElement;
    expect(body.contains(wrap)).toBe(false);
    expect(wrap.parentElement).toBe(screen.getByTestId('feature-tile'));
    expect(wrap.getAttribute('aria-hidden')).toBe('true');
    expect(wrap.className).toContain('pointer-events-none');
    expect(body.className).toContain('after:absolute');
    expect(body.className).toContain('after:inset-0');
    expect(screen.getByTestId('feature-tile').className).toContain('relative');
  });

  it('keeps the menu and the footer above the stretched button', () => {
    if (!part) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={part} library={library} size="md" onOpen={vi.fn()} actions={actions()} footer={<button type="button">Add</button>} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: 'More actions for Number tile' }).closest('div.absolute')?.className).toContain('z-10');
    expect(screen.getByRole('button', { name: 'Add' }).parentElement?.className).toContain('z-10');
  });

  it('keeps the settings and description out of a small tile and marks a chosen one', () => {
    if (!withParams) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={withParams} library={library} size="sm" selected onOpen={vi.fn()} actions={actions()} />
      </ul>,
    );
    expect(screen.queryByText(withParams.description)).toBeNull();
    expect(screen.getByRole('button', { name: `Show details for ${withParams.name}` }).getAttribute('aria-pressed')).toBe('true');
  });

  it('marks a feature that needs repair', () => {
    const [broken] = buildShowcaseEntries([recordOf(SEED_FEATURES[0], { ok: false, fragment: null })]).slice(-1);
    render(
      <ul>
        <FeatureTile entry={broken} library={library} size="md" onOpen={vi.fn()} actions={actions()} />
      </ul>,
    );
    expect(screen.getByText('Needs repair')).toBeTruthy();
  });
  it('has no actions menu when it has no actions', () => {
    if (!part) throw new Error('fixtures');
    render(
      <ul>
        <FeatureTile entry={part} library={library} size="sm" onOpen={vi.fn()} actions={[]} />
      </ul>,
    );
    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('keeps its body button in the Tab order, unless openFocusable is false', () => {
    if (!part) throw new Error('fixtures');
    const { rerender } = render(
      <ul>
        <FeatureTile entry={part} library={library} size="sm" onOpen={vi.fn()} actions={[]} />
      </ul>,
    );
    const body = (): HTMLElement => screen.getByRole('button', { name: `Show details for ${part.name}` });
    expect(body().getAttribute('tabindex')).toBeNull();
    rerender(
      <ul>
        <FeatureTile entry={part} library={library} size="sm" onOpen={vi.fn()} actions={[]} openFocusable={false} />
      </ul>,
    );
    expect(body().getAttribute('tabindex')).toBe('-1');
  });
});
