// The collapsed side menu: a view choice of the person using the app, kept per app in this browser (localStorage, also there
// in a built app's WebView), never in the spec. Only the stored '1' reads as collapsed: a missing or broken value is expanded.
import { useState } from 'react';
import { lsKey } from '@/utils/storageKeys.js';

const keyFor = (slug) => lsKey(`menu.collapsed.${slug}`);

/** True when this app's side menu was left collapsed here. No slug (a spec that was never validated) reads as expanded. */
export function readMenuCollapsed(slug) {
  if (typeof slug !== 'string' || slug === '') return false;
  try {
    return window.localStorage.getItem(keyFor(slug)) === '1';
  } catch {
    return false;
  }
}

export function writeMenuCollapsed(slug, collapsed) {
  if (typeof slug !== 'string' || slug === '') return;
  try {
    if (collapsed) window.localStorage.setItem(keyFor(slug), '1');
    else window.localStorage.removeItem(keyFor(slug));
  } catch {
    // Storage full or blocked: the choice is lost on reload, nothing else.
  }
}

/** `[collapsed, setCollapsed]` for one app; another app (a new slug) reads its own stored choice. */
export function useMenuCollapsed(slug) {
  const [state, setState] = useState(() => ({ slug, collapsed: readMenuCollapsed(slug) }));
  const collapsed = state.slug === slug ? state.collapsed : readMenuCollapsed(slug);
  const set = (next) => {
    writeMenuCollapsed(slug, next);
    setState({ slug, collapsed: next });
  };
  return [collapsed, set];
}
