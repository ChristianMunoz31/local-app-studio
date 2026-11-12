// Studio's own controls on the canvas (block toolbar, settings popover, "Add here" and "Drop here") must keep the kit theme,
// so they cannot be descendants of the ThemeScope that carries the app's look. DesignCanvas renders one chrome layer next to
// the scope; each control is portaled into it and placed from the bounding box of the element it belongs to.
import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

const ChromeContext = createContext<HTMLElement | null>(null);
export function ChromeProvider({ layer, children }: { layer: HTMLElement | null; children: ReactNode }) {
  return <ChromeContext.Provider value={layer}>{children}</ChromeContext.Provider>;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const ZERO: Box = { top: 0, left: 0, width: 0, height: 0 };
const same = (a: Box, b: Box): boolean => a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

const measure = (target: HTMLElement, layer: HTMLElement): Box => {
  const t = target.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  return { top: t.top - l.top, left: t.left - l.left, width: t.width, height: t.height };
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface PortalProps {
  /** The element the controls belong to: they are placed over its bounding box. */
  targetRef: RefObject<HTMLElement | null>;
  active: boolean;
  className?: string;
  /** Tab leaves the controls into the page again: the focus goes back to this element, then on to the one after it. */
  returnRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function ChromePortal({ targetRef, active, className = '', returnRef, children }: PortalProps) {
  const layer = useContext(ChromeContext);
  const [box, setBox] = useState<Box>(ZERO);
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);

  const place = useCallback((): void => {
    const target = targetRef.current;
    if (target === null || layer === null) return;
    const next = measure(target, layer);
    setBox((prev) => (same(prev, next) ? prev : next));
  }, [targetRef, layer]);

  // Measured after every render, because a block can move without changing size (a sibling above it grows, or it is moved).
  // The state only changes when the rectangle does, so this settles.
  // A child's layout effect runs before its parent's ref is set, so the first pass can find no target: the portal's own node
  // (`wrap`) is set after mount and its dependency below subscribes once the block is there.
  useLayoutEffect(() => {
    if (active) place();
  });

  // Watches the block, the canvas and the window for size changes. Subscribed once per target, not on every render.
  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!active || layer === null || target === null) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(target);
    observer?.observe(layer);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [active, layer, targetRef, place, wrap]);

  if (!active || layer === null) return null;
  const style: CSSProperties = { top: box.top, left: box.left, width: box.width, height: box.height };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const back = returnRef?.current;
    if (e.key !== 'Tab' || !back || wrap === null) return;
    const items = Array.from(wrap.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    if (e.shiftKey && e.target === items[0]) {
      e.preventDefault();
      back.focus();
    } else if (!e.shiftKey && e.target === items[items.length - 1]) {
      // No preventDefault: the browser moves on from the block, which is where the page order continues.
      back.focus();
    }
  };

  return createPortal(
    <div ref={setWrap} data-chrome="" style={style} className={`pointer-events-none absolute ${className}`} onKeyDown={onKeyDown}>
      {children}
    </div>,
    layer,
  );
}
