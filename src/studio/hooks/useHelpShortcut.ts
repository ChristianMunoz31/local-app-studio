import { useEffect, useRef } from 'react';

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const DIALOG = '[role="dialog"], [role="alertdialog"]';

/** Calls onOpen when the person presses ? outside text fields and with no dialog open. */
export function useHelpShortcut(onOpen: () => void): void {
  const ref = useRef(onOpen);
  useEffect(() => {
    ref.current = onOpen;
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TYPING)) return;
      if (document.querySelector(DIALOG)) return;
      e.preventDefault();
      ref.current();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
