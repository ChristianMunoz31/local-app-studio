// The frame around the app on screen (Preview and Design): a toolbar with the app's name, "Show as" and, on Preview, Enlarge, over the app itself.
// Enlarged, the frame fills the window in a dialog portalled to document.body. The app is not remounted: its children render through one portal
// into a container node that is moved, with appendChild, between the inline body and the dialog (docs/phase19/DESIGN-phase19.md 3.3).
// The page behind is inert while enlarged and the body scroll is left alone: the layer scrolls its own body (overscroll-contain).
import { Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeMode } from '@local-app-studio/runtime/theme/ids.ts';
import { btnSecondary } from '@/components/shared/formStyles.js';
import ViewModeToggle from '../theme/ViewModeToggle';
import { restoreScroll, saveScroll } from './canvasScroll';

/** card: Preview, a glass card in the page flow. pane: Design, a bordered pane that fills its flex column and scrolls its body at lg. */
export type CanvasFrameLayout = 'card' | 'pane';

export interface CanvasFrameProps {
  /** The app's name: left of the toolbar, and the enlarged layer's label. */
  name: string;
  /** The Show as choice (from useViewMode). */
  mode: ThemeMode;
  onModeChange(mode: ThemeMode): void;
  layout: CanvasFrameLayout;
  /** Offer Enlarge. Preview only this phase; never set with layout "pane". */
  enlargeable?: boolean;
  children: ReactNode;
}

export const ENLARGE = 'Enlarge';
export const SHRINK = 'Shrink';
// eslint-disable-next-line react-refresh/only-export-components -- the words live with the component that shows them (docs/phase19/DESIGN-phase19.md 3.2)
export const enlargedLabel = (name: string): string => `${name}, enlarged`;

const BORDER = 'border-[color:var(--glass-border-strong)]';

/** Targets that keep Escape for themselves: an open popup the app has not marked as handled, or a native picker. */
const OWNS_ESCAPE = '[aria-haspopup][aria-expanded="true"],[role="combobox"][aria-expanded="true"],[role="listbox"],[role="menu"]';
const PICKER_TYPES = ['date', 'time', 'datetime-local', 'month', 'week'];

/** The Studio root: the child of document.body that holds the frame. It gets inert while the layer is up (the layer is a sibling, so it stays live). */
function studioRootOf(from: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = from;
  while (el !== null && el.parentElement !== document.body) el = el.parentElement;
  return el;
}

export default function CanvasFrame({ name, mode, onModeChange, layout, enlargeable = false, children }: CanvasFrameProps): ReactElement {
  const [enlarged, setEnlarged] = useState(false);
  const [container] = useState(() => {
    const node = document.createElement('div');
    node.className = 'flex min-h-full flex-1 flex-col';
    return node;
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const enlargeRef = useRef<HTMLButtonElement>(null);
  const shrinkRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const moveBody = useCallback(
    (target: HTMLElement | null): void => {
      if (target === null || container.parentNode === target) return;
      const marks = saveScroll(container);
      target.appendChild(container);
      restoreScroll(marks);
    },
    [container],
  );

  // First mount only: the container is not attached yet. A later Enlarge or Shrink moves it through moveBody.
  const setInline = useCallback(
    (el: HTMLDivElement | null): void => {
      inlineRef.current = el;
      if (el !== null && enlargeable && container.parentNode === null) el.appendChild(container);
    },
    [container, enlargeable],
  );
  const setHost = useCallback(
    (el: HTMLDivElement | null): void => {
      if (el !== null) moveBody(el);
    },
    [moveBody],
  );

  const enlarge = useCallback((): void => setEnlarged(true), []);
  const shrink = useCallback((): void => {
    returnFocus.current = true;
    moveBody(inlineRef.current);
    setEnlarged(false);
  }, [moveBody]);

  useEffect(() => {
    if (!enlarged) {
      if (returnFocus.current) {
        returnFocus.current = false;
        enlargeRef.current?.focus();
      }
      return undefined;
    }
    const root = studioRootOf(frameRef.current);
    const addedInert = root !== null && !root.hasAttribute('inert');
    if (root !== null && addedInert) root.setAttribute('inert', '');
    shrinkRef.current?.focus();
    const layer = layerRef.current;
    // Escape from the layer, or from the body when focus fell there (a click on blank app space), is ours. A Modal's target is outside the layer,
    // and with a Modal open an Escape on the body belongs to that Modal.
    const isOurs = (e: KeyboardEvent): boolean => {
      if (e.target === document.body) return !Array.from(document.querySelectorAll('[aria-modal="true"]')).some((m) => m !== layer);
      return e.target instanceof Node && layer !== null && layer.contains(e.target);
    };
    // Capture: the whole Studio is inert, but the command palette lives in it and listens on window. Ctrl/Cmd+K from anywhere (an app Modal is body-level) stops here.
    const onKeyCapture = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) e.stopPropagation();
    };
    // Bubble: the app's own handlers (a React onKeyDown) see Escape first and can mark it handled.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !isOurs(e)) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const ownsEscape =
        target !== null &&
        (target.tagName === 'SELECT' || (target instanceof HTMLInputElement && PICKER_TYPES.includes(target.type)) || target.closest(OWNS_ESCAPE) !== null);
      if (e.defaultPrevented || e.isComposing || ownsEscape) return;
      e.preventDefault();
      shrink();
    };
    document.addEventListener('keydown', onKeyCapture, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyCapture, true);
      document.removeEventListener('keydown', onKeyDown);
      if (root !== null && addedInert) root.removeAttribute('inert');
    };
  }, [enlarged, shrink]);

  const toolbar = (pinned: boolean): ReactElement => (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b ${BORDER} px-3 py-2${pinned ? ' shrink-0' : ''}`}>
      <p className="min-w-0 flex-1 basis-40 break-words text-sm font-bold tracking-tight text-slate-slate100">{name}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ViewModeToggle mode={mode} onChange={onModeChange} />
        {enlargeable && (
          <button type="button" ref={enlarged ? shrinkRef : enlargeRef} className={btnSecondary} onClick={enlarged ? shrink : enlarge}>
            <span className="inline-flex items-center gap-1.5">
              {enlarged ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
              {enlarged ? SHRINK : ENLARGE}
            </span>
          </button>
        )}
      </div>
    </div>
  );

  const frameClass = layout === 'card' ? 'glass rounded-2xl' : `flex min-h-0 flex-1 flex-col rounded-2xl border ${BORDER} lg:min-h-80`;
  const bodyClass = layout === 'card' ? 'min-h-96 p-2' : 'min-h-0 flex-1 p-2 lg:overflow-y-auto';

  return (
    <div ref={frameRef} className={frameClass}>
      {!enlarged && toolbar(layout === 'pane')}
      {enlarged &&
        createPortal(
          <div className="glass-overlay fixed inset-0 z-50 flex p-2 sm:p-3">
            <div ref={layerRef} role="dialog" aria-modal="true" aria-label={enlargedLabel(name)} tabIndex={-1} className="glass-flat flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl focus:outline-hidden">
              {toolbar(true)}
              <div ref={setHost} className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain p-2" />
            </div>
          </div>,
          document.body,
        )}
      <div ref={setInline} className={bodyClass}>
        {!enlargeable && children}
      </div>
      {enlargeable && createPortal(children, container)}
    </div>
  );
}
