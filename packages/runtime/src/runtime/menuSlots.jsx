// The menu slots at run time (docs/APP_SPEC.md, "Menu slots"). AppMenuFrame draws the bar and the two slot boxes outside the
// page's CatalogPageProvider; MenuSlotPortals sits inside it and portals each slot's parts into its box, so a menu SearchBox
// reaches the page's search, a menu QuickAdd refreshes the page's tables and a menu Button opens its form in the page's host.
// No zod and no editor: the allow list and limits live in src/spec/menuSlots.ts, which is import free.
/* eslint-disable react-refresh/only-export-components -- the context and the component that reads it belong in this one file */
import { createContext, createElement, useContext } from 'react';
import { createPortal } from 'react-dom';
import { useCatalogData } from '@/catalog/context';
import { menuSearchTarget, resolveMenuLayers } from '../catalog/parts/menuSearch.ts';
import { MENU_SLOTS } from '../spec/menuSlots.ts';
import { SpecRenderer } from './SpecRenderer.jsx';

/** `{ start: { el, layers }, end: { el, layers } }`, or null when the app has no menu slots (Classic, Design, previews). */
export const MenuSlotContext = createContext(null);

/** Renders each slot's parts into its box. Null without a context. */
export function MenuSlotPortals() {
  const slots = useContext(MenuSlotContext);
  const data = useCatalogData();
  if (slots === null) return null;
  const target = menuSearchTarget(data.spec, data.pageId);
  return MENU_SLOTS.map((slot) => {
    const { el, layers } = slots[slot];
    if (!el || layers.length === 0) return null;
    return createPortal(
      resolveMenuLayers(layers, target).map((layer) => createElement(SpecRenderer, { key: layer.id, layer })),
      el,
      slot,
    );
  });
}
