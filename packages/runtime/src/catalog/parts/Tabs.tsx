import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

interface TabInfo {
  id: string;
  label: string;
}

interface TabsState {
  active: string | null;
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
  panelId: (id: string) => string;
  tabId: (id: string) => string;
}

// The Tab parts are rendered children of Tabs, so they tell Tabs their label through this context.
const TabsContext = createContext<TabsState | null>(null);

export type TabsProps = EditorProps;

/** Switchable panels. Each Tab child registers its label; the first tab shows until another is chosen. */
export function Tabs(props: TabsProps) {
  const { className, ...dom } = editorDomProps(props);
  const uid = useId();
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = tabs.some((t) => t.id === selected) ? selected : (tabs[0]?.id ?? null);

  const register = useCallback((id: string, label: string) => {
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev.map((t) => (t.id === id ? { id, label } : t)) : [...prev, { id, label }]));
  }, []);
  const unregister = useCallback((id: string) => setTabs((prev) => prev.filter((t) => t.id !== id)), []);
  const tabId = useCallback((id: string) => `${uid}-tab-${id}`, [uid]);
  const panelId = useCallback((id: string) => `${uid}-panel-${id}`, [uid]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (tabs.length === 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    const at = Math.max(0, tabs.findIndex((t) => t.id === active));
    const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setSelected(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  return (
    <TabsContext.Provider value={{ active, register, unregister, panelId, tabId }}>
      <div {...dom} className={cx('space-y-3', className)}>
        <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-1 border-b border-[color:var(--glass-border)]" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.id}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={t.id === active}
              aria-controls={panelId(t.id)}
              tabIndex={t.id === active ? 0 : -1}
              onClick={() => setSelected(t.id)}
              className={cx(
                '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight',
                t.id === active ? 'border-accent-indigo text-slate-slate100' : 'border-transparent text-slate-slate400 hover:text-slate-slate100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {props.children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabProps extends EditorProps {
  label?: string;
}

/** One panel of a Tabs part. Outside Tabs it just shows its parts. */
export function Tab({ label = 'Tab', ...rest }: TabProps) {
  const ctx = useContext(TabsContext);
  const own = useId();
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  useEffect(() => {
    register?.(own, label);
  }, [register, own, label]);
  useEffect(() => () => unregister?.(own), [unregister, own]);
  const { className, ...dom } = editorDomProps(rest);
  if (!ctx) return <div {...dom} className={className}>{rest.children}</div>;
  if (ctx.active !== own) return null;
  return (
    <div {...dom} id={ctx.panelId(own)} role="tabpanel" aria-labelledby={ctx.tabId(own)} className={cx('space-y-3', className)}>
      {rest.children}
    </div>
  );
}
