import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, renderHook } from '@testing-library/react';
import {
  PageContextProvider,
  usePageContext,
  usePageContextReader,
} from '../PageContextContext';

afterEach(cleanup);

function Page({ pageKey = 'items', builder }) {
  usePageContext(pageKey, builder);
  return null;
}

function Reader({ onReader }) {
  onReader(usePageContextReader());
  return null;
}

function setup(ui) {
  let reader;
  const utils = render(
    <PageContextProvider>
      {ui}
      <Reader onReader={(r) => (reader = r)} />
    </PageContextProvider>,
  );
  return { ...utils, read: (key) => reader.readPageContext(key) };
}

describe('PageContextContext', () => {
  it('calls the builder only when read, not on register or re-render', () => {
    const builder = vi.fn(() => ({ n: 1 }));
    const { rerender, read } = setup(<Page builder={builder} />);
    expect(builder).not.toHaveBeenCalled();
    rerender(
      <PageContextProvider>
        <Page builder={builder} />
        <Reader onReader={() => {}} />
      </PageContextProvider>,
    );
    expect(builder).not.toHaveBeenCalled();
    const out = read('items');
    expect(builder).toHaveBeenCalledTimes(1);
    expect(out.registered).toBe(true);
    expect(JSON.parse(out.context).data).toEqual({ n: 1 });
  });

  it('uses the latest closure after a re-render', () => {
    let reader;
    const tree = (value) => (
      <PageContextProvider>
        <Page builder={() => ({ value })} />
        <Reader onReader={(r) => (reader = r)} />
      </PageContextProvider>
    );
    const { rerender } = render(tree(1));
    rerender(tree(2));
    expect(JSON.parse(reader.readPageContext('items').context).data).toEqual({ value: 2 });
  });

  it('unregisters on unmount and falls back to route/title', () => {
    let reader;
    const tree = (withPage) => (
      <PageContextProvider>
        {withPage && <Page pageKey="settings" builder={() => ({ a: 1 })} />}
        <Reader onReader={(r) => (reader = r)} />
      </PageContextProvider>
    );
    const { rerender } = render(tree(true));
    expect(reader.readPageContext('settings').registered).toBe(true);
    rerender(tree(false));
    const out = reader.readPageContext('settings');
    expect(out.registered).toBe(false);
    expect(JSON.parse(out.context).data).toEqual({ route: 'settings', title: 'Settings' });
  });

  it('a stale unregister does not delete a newer registration', () => {
    let reader;
    const tree = (second) => (
      <PageContextProvider>
        <Page key="a" builder={() => ({ who: 'first' })} />
        {second && <Page key="b" builder={() => ({ who: 'second' })} />}
        <Reader onReader={(r) => (reader = r)} />
      </PageContextProvider>
    );
    const { rerender } = render(tree(false));
    rerender(tree(true)); // second registers over the first
    expect(JSON.parse(reader.readPageContext('items').context).data).toEqual({ who: 'second' });
    rerender(
      <PageContextProvider>
        <Page key="b" builder={() => ({ who: 'second' })} />
        <Reader onReader={(r) => (reader = r)} />
      </PageContextProvider>,
    ); // first unmounts: its unregister must not remove the second
    expect(reader.readPageContext('items').registered).toBe(true);
  });

  it('is a silent no-op without a provider', () => {
    const builder = vi.fn(() => ({}));
    expect(() => render(<Page builder={builder} />)).not.toThrow();
    expect(builder).not.toHaveBeenCalled();
    const { result } = renderHook(() => usePageContextReader());
    expect(result.current.readPageContext('items').registered).toBe(false);
  });

  it('a throwing builder yields the context-unavailable note', () => {
    const { read } = setup(
      <Page
        builder={() => {
          throw new Error('boom');
        }}
      />,
    );
    expect(JSON.parse(read('items').context).data).toEqual({ error: 'context unavailable' });
  });
});
