// The runtime renderer (ADR-001): pages of an AppSpec rendered with the catalog parts. One renderer for the designer
// preview, Studio Preview and every built app. SpecPage renders one page; SpecApp adds routing from the spec nav.
// Own renderer (SpecRenderer.jsx): no @/vendor and no zod in this folder, so a built app never loads the editor chunk.
import { createElement, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CatalogPageProvider } from '@/catalog/context';
import { normalizeSpec } from './normalizeSpec.js';
import { usePageContext } from '../../../../src/contexts/PageContextContext';
import { createHttpDataSource } from './dataClient.js';
import { joinPath, matchSpecRoute, routeFor, stripBase } from './routing.js';
import { AppMenuFrame, cornerTrail } from './AppMenu.jsx';
import { MenuSlotPortals } from './menuSlots.jsx';
import { hasSlotLayers } from '../spec/menuSlots.ts';
import { SpecRenderer } from './SpecRenderer.jsx';
import { PageBoundary } from './PageBoundary.jsx';

const NOTE = 'p-4 text-sm text-slate-slate400';

const notFound = (text) => createElement('p', { className: NOTE }, text);

/**
 * Renders one page of a spec.
 * @param {{
 *   spec: import('../spec/schema.ts').AppSpec,
 *   pageId: string,
 *   apiBase?: string,
 *   navigate?: (pageId: string, opts: { withRecord: boolean, recordId?: string }) => void,
 *   recordId?: string | null,
 *   dataSource?: import('@/catalog/context').CatalogDataSource,
 * }} props
 */
export function SpecPage({ spec, pageId, apiBase = '/api', navigate, recordId = null, dataSource }) {
  const normalized = useMemo(() => normalizeSpec(spec), [spec]);
  const page = normalized?.pages?.find((p) => p.id === pageId);
  const source = useMemo(() => dataSource ?? createHttpDataSource(apiBase), [dataSource, apiBase]);
  const value = useMemo(
    () => ({ apiBase, navigate, spec: normalized ?? undefined, pageId, recordId, dataSource: source }),
    [apiBase, navigate, normalized, pageId, recordId, source],
  );
  if (!page) return notFound('This page is not part of the app.');
  return createElement(
    CatalogPageProvider,
    { value, key: page.id },
    createElement(SpecRenderer, { layer: page.layout }),
    createElement(MenuSlotPortals),
  );
}

/**
 * Renders a spec at the current router location. Needs a react-router context, declares no `<Routes>`: it strips
 * `basePath` from the path and matches the page routes itself (routing.js), so one catch-all route can host it.
 * `menuTrail` (a built app's Assistant and Settings buttons) goes at the end of the menu bar, or in a corner pill when the
 * spec has no bar; Preview passes none.
 * @param {{ spec: import('../spec/schema.ts').AppSpec, apiBase?: string, basePath?: string, menuTrail?: import('react').ReactNode }} props
 */
export function SpecApp({ spec, apiBase = '/api', basePath = '/', menuTrail = null }) {
  const normalized = useMemo(() => normalizeSpec(spec), [spec]);
  const { pathname } = useLocation();
  const routerNavigate = useNavigate();
  const rel = stripBase(basePath, pathname);
  const match = rel === null ? null : matchSpecRoute(normalized, rel);
  const dataSource = useMemo(() => createHttpDataSource(apiBase), [apiBase]);
  const navigate = useCallback(
    (pageId, { withRecord, recordId }) => {
      const route = routeFor(normalized, pageId, withRecord ? recordId : null);
      if (route === null) return;
      routerNavigate(joinPath(basePath, route));
    },
    [normalized, basePath, routerNavigate],
  );

  // Titles and table names only: no rows, no counts (cloud providers see this when the user asks for advice).
  usePageContext('app', () => {
    const page = normalized?.pages?.find((p) => p.id === match?.pageId);
    const labels = (page?.sources ?? []).map((s) => normalized.tables.find((t) => t.id === s.table)?.label ?? s.table);
    return { app: normalized?.app?.name ?? null, page: page?.title ?? null, tables: [...new Set(labels)] };
  });

  // A missing page keeps the menu slot parts working, in a provider of its own with no page (a menu SearchBox hides itself).
  const missingValue = useMemo(
    () => ({ apiBase, navigate, spec: normalized ?? undefined, pageId: undefined, recordId: null, dataSource }),
    [apiBase, navigate, normalized, dataSource],
  );
  const missing = () =>
    createElement(
      'div',
      { className: 'p-4 sm:p-6 max-w-7xl mx-auto' },
      createElement(
        'div',
        { className: 'glass rounded-2xl p-5 space-y-2' },
        createElement('h2', { className: 'text-sm font-bold text-slate-slate100' }, 'Page not found'),
        createElement('p', { className: 'text-sm text-slate-slate400' }, 'This page is not part of the app.'),
        createElement(
          Link,
          { to: joinPath(basePath, '/'), className: 'text-sm text-accent-indigo underline' },
          'Go to the home page',
        ),
      ),
    );

  const content = match
    ? createElement(SpecPage, {
        spec: normalized,
        pageId: match.pageId,
        recordId: match.recordId,
        apiBase,
        navigate,
        dataSource,
      })
    : hasSlotLayers(normalized?.menu)
      ? createElement(CatalogPageProvider, { value: missingValue }, missing(), createElement(MenuSlotPortals))
      : missing();
  // The menu bar wraps the page only when the spec asks for it: a Classic app renders exactly what it did before.
  const menu = normalized?.menu;
  const hasMenu = menu !== null && typeof menu === 'object' && !Array.isArray(menu);
  const homeTo = joinPath(basePath, '/');
  const trimmed = (path) => path.replace(/\/+$/, '');
  // Keyed by path: a menu click leaves a failed page and renders the next one fresh. The fallback names the menu only
  // when there is one, and offers the home link only from another page.
  const body = createElement(
    PageBoundary,
    { key: pathname, homeTo, atHome: trimmed(pathname) === trimmed(homeTo), hasMenu },
    content,
  );
  if (!hasMenu) return cornerTrail(body, menuTrail);
  return createElement(AppMenuFrame, { spec: normalized, pageId: match ? match.pageId : null, basePath, trail: menuTrail }, body);
}
