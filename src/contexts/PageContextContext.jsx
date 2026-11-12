import { createContext, useContext, useEffect, useId, useMemo, useRef } from 'react';
import { ASSISTANT_PAGES } from '../constants/assistantPages';
import { serializeAssistantContext } from '../utils/assistantContext';
import { buildFallbackContext } from '../utils/assistantBuilders/fallback';

// Registry of lazy page-context builders for the Assistant advisor. Pages register a
// builder closure; nothing is called until the advisor reads it (panel open / send).
// Registration never causes a re-render: the registry is a ref and the context value
// is a stable object.

const PageContext = createContext(null);

export function PageContextProvider({ children }) {
  const registry = useRef(new Map());

  const api = useMemo(
    () => ({
      register(key, id, builderRef) {
        registry.current.set(key, { id, builderRef });
      },
      unregister(key, id) {
        const entry = registry.current.get(key);
        if (entry && entry.id === id) registry.current.delete(key);
      },
      readPageContext(key) {
        const entry = registry.current.get(key);
        const now = new Date();
        let data;
        if (!entry) {
          data = buildFallbackContext({ routeName: key, title: ASSISTANT_PAGES[key]?.label });
        } else {
          try {
            data = entry.builderRef.current?.() ?? null;
          } catch {
            data = { error: 'context unavailable' };
          }
        }
        const { context, truncated } = serializeAssistantContext({ pageKey: key, data, now });
        const loading = data?.status === 'loading';
        return { context, truncated, registered: !!entry, loading };
      },
    }),
    [],
  );

  return <PageContext.Provider value={api}>{children}</PageContext.Provider>;
}

/**
 * Registers `builder` as the context source for page `key`. A silent no-op without a
 * provider. Call it unconditionally at the top of the component (before early returns).
 * @param {string} key
 * @param {() => object | null} builder
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageContext(key, builder) {
  const api = useContext(PageContext);
  const ref = useRef(builder);
  const id = useId();

  // Always point at the latest closure; ref writes are not allowed during render.
  useEffect(() => {
    ref.current = builder;
  });

  useEffect(() => {
    if (!api) return undefined;
    api.register(key, id, ref);
    return () => api.unregister(key, id);
  }, [api, key, id]);
}

/**
 * @returns {{ readPageContext: (key: string) => { context: string, truncated: boolean, registered: boolean, loading: boolean } }}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageContextReader() {
  const api = useContext(PageContext);
  return useMemo(
    () => ({
      readPageContext: (key) =>
        api
          ? api.readPageContext(key)
          : {
              ...serializeAssistantContext({
                pageKey: key,
                data: buildFallbackContext({ routeName: key, title: ASSISTANT_PAGES[key]?.label }),
              }),
              registered: false,
              loading: false,
            },
    }),
    [api],
  );
}
