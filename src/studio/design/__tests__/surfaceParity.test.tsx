// P3 "One renderer for every surface" (docs/LESSONS.md): every page of every example app is drawn three ways, and the three are compared.
//   runtime  the route a built app mounts (buildRuntimeModule: RuntimeApp over the baked spec, with the entry buttons as menuTrail).
//   preview  the real PreviewTab (SpecApp over /api/preview inside ThemeScope and PortalScopeContext), with the preview child answered by a stub.
//   canvas   the real DesignCanvas (CanvasNode, CanvasBlock, ThemeScope) with the same rows.
// All three read the same rows through sampleDataSource (createHttpDataSource is swapped for it). Preview must equal runtime
// exactly; the canvas must equal runtime after the named normalizations below (CANVAS_ONLY: editor chrome; LIVE_ONLY: the documented
// "not live" differences, which are also asserted one by one, not just hidden). The menu bar is compared Preview to runtime only: the
// canvas draws it as a picture with drop sides (MenuCanvas), so the canvas is compared on the page body, the part tree under the page root.
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, Suspense } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogData, DataRow } from '@/catalog/context';
import { partContextFor } from '@/catalog/validateLayout';
import RuntimeApp from '@local-app-studio/runtime/runtime/RuntimeApp.jsx';
import { normalizeSpec } from '@local-app-studio/runtime/runtime/normalizeSpec.js';
import { joinPath, routeFor } from '@local-app-studio/runtime/runtime/routing.js';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { startRuntimeTheme } from '@local-app-studio/runtime/theme/applyRoot';
import { libraryOf } from '../../hooks/useFeatures';
import { checkSampleShape } from '../../lib/sampleData';
import { sampleDataSource } from '../../lib/sampleDataSource';
import type { TreeResult } from '../../lib/layoutTree';
import { sampleBackedRows } from '../../showcase/samples';
import { StepChromeContext } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import type { PreviewStatus, WorkspaceValue } from '../../types';
import PreviewTab from '../../pages/PreviewTab';
import DesignCanvas from '../DesignCanvas';
import { DesignContext } from '../DesignContext';
import type { DesignContextValue } from '../DesignContext';
import { buildRuntimeModule } from '@/modules/runtime.jsx';

// ---- Stubs: the data layer, the preview child and the helper (nothing here touches a network or a timer). ----
const source = vi.hoisted(() => ({ current: null as null | object }));
vi.mock('@local-app-studio/runtime/runtime/dataClient.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@local-app-studio/runtime/runtime/dataClient.js')>();
  return { ...real, createHttpDataSource: () => source.current };
});
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: false, installer: false, licensing: false, cloud: false } }));
const api = vi.hoisted(() => ({ previewStatus: vi.fn(), previewStart: vi.fn(), previewStop: vi.fn(), previewReset: vi.fn(), getApp: vi.fn() }));
vi.mock('../../services/studioApi', () => api);
vi.mock('@/hooks/useOllamaSetup.js', () => ({ useOllamaSetup: () => ({ setup: null, isLoading: false }) }));
vi.mock('../../hooks/useDescribeSession', () => ({ useOptionalDescribeSession: () => null }));

// ---- The examples: spec and records, read from public/examples like the app does. ----
const FILES = import.meta.glob('../../../../public/examples/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const TODAY = new Date(2026, 5, 15, 12, 0, 0);
const APP_ID = 'app-1';
const REVISION = 3;

interface Example {
  id: string;
  spec: AppSpec;
  rows: Record<string, DataRow[]>;
}
const EXAMPLE_IDS = Object.keys(FILES)
  .map((p) => /\/([^/]+)\.spec\.json$/.exec(p)?.[1])
  .filter((id): id is string => id !== undefined)
  .sort();
function load(id: string): Example {
  const read = (suffix: string): unknown => JSON.parse(FILES[`../../../../public/examples/${id}.${suffix}.json`]);
  const spec = AppSpecSchema.parse(read('spec'));
  const sample = checkSampleShape(read('records'));
  if (sample === null) throw new Error(`${id}: records are not a sample`);
  return { id, spec, rows: sampleBackedRows(spec, sample, TODAY) };
}

// ---- Normalization: a DOM becomes a list of lines (tag, classes, attributes, text), one per node, indented by depth. ----
type Surface = 'canvas' | 'runtime' | 'preview';

/**
 * What the canvas legitimately adds around the real parts. Every entry has one reason; nothing else is removed or ignored.
 * `unwrap` keeps the children and drops the element, `remove` drops the element and everything in it, `attrs` are dropped from every element.
 */
const CANVAS_ONLY = {
  unwrap: [
    ['[data-canvas-block]', 'CanvasBlock: the selectable, outlined group around each part (role group, aria-label, tabindex, handlers)'],
    ['div[inert]', 'CanvasBlock: leaf parts are drawn as a picture inside an inert box so nothing in them can be clicked'],
  ],
  remove: [
    ['[data-zone]', 'DropZone and SideZone: the places a part can be dropped'],
    ['[data-grid-area]', 'GridDropArea: the drop box over a free Grid'],
    ['[data-grid-cells]', 'GridDropArea: the dotted cell overlay shown while dragging'],
    ['div:has(> [data-indicator])', 'ConnectionBadge row: the "Shows <table>" pill above a data part'],
    ['div.pointer-events-none.absolute.inset-y-0.-right-4.z-10.w-4', 'ResizeHandle: the drag handle between two parts side by side'],
  ],
  attrs: [
    ['data-layer-id', 'the runtime puts the layer id on the part; the canvas puts it on the CanvasBlock instead'],
    ['data-testid', 'the runtime puts the layer id on the part as a test hook; the canvas has none'],
    ['data-sizing-row', 'a marker on the canvas row, which has the same classes as the runtime row'],
    ['data-grid-item', 'marker for the canvas grid wrapper, which has the same classes as the runtime one'],
    ['data-grid-place', 'the stored place of a grid part, read by the grid keyboard tools'],
  ],
} as const;
const UNWRAP = CANVAS_ONLY.unwrap.map(([sel]) => sel);
const REMOVE = CANVAS_ONLY.remove.map(([sel]) => sel);
const DROP_ATTRS = new Set<string>(CANVAS_ONLY.attrs.map(([name]) => name));
// Attributes that hold an id or a list of ids: the values come from useId (":r1:", ":r2:"), so they are numbered by first appearance.
const ID_REFS = ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-activedescendant'];

function unwrap(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

/** Preview serves the app below /apps/<id>/preview, a built app at /: the menu links carry that base. */
const PREVIEW_BASE = `/apps/${APP_ID}/preview`;

/**
 * The documented "not live" differences (docs/CATALOG.md "Live or not": the canvas has no navigate, so useIsLive is false).
 * Applied to the canvas AND the runtime body before they are compared, so the rest of those parts is still compared; each one is
 * asserted separately by assertLiveDifferences, so it cannot become a way to hide a real difference.
 */
const LIVE_ONLY = [
  ['RecordForm', 'no Save button when not live (RecordForm.tsx hideSubmit); the toolbar Save is the only one on the canvas'],
  ['Checklist', 'the checkboxes are disabled when not live (they would write)'],
  ['QuickAdd', 'the input and Add are disabled, with a hint "Adding works in the running app." (aria-describedby), when not live'],
  ['Collapsible', 'always open when not live (aria-expanded, hidden, the chevron turn)'],
] as const;
type LiveKind = (typeof LIVE_ONLY)[number][0];
const LIVE_TYPES: readonly string[] = LIVE_ONLY.map(([kind]) => kind);

const HINT = 'Adding works in the running app.';
const within = (root: Element, layer: LayoutLayer): Element[] => Array.from(root.querySelectorAll(`[data-layer-id="${layer.id}"]`));

function neutralizeLive(copy: Element, layers: LayoutLayer[]): void {
  for (const layer of layers) {
    for (const el of within(copy, layer)) {
      if (layer.type === 'RecordForm') for (const b of Array.from(el.querySelectorAll('button[type="submit"]'))) b.remove();
      if (layer.type === 'Checklist') for (const b of Array.from(el.querySelectorAll('input[type="checkbox"]'))) b.removeAttribute('disabled');
      if (layer.type === 'QuickAdd') {
        for (const b of Array.from(el.querySelectorAll('input, button'))) b.removeAttribute('disabled');
        for (const hint of Array.from(el.querySelectorAll('p[id$="-hint"]'))) {
          for (const d of Array.from(el.querySelectorAll('[aria-describedby]'))) {
            const rest = (d.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t !== hint.id).join(' ');
            if (rest === '') d.removeAttribute('aria-describedby');
            else d.setAttribute('aria-describedby', rest);
          }
          hint.remove();
        }
      }
      if (layer.type === 'Collapsible') {
        for (const b of Array.from(el.querySelectorAll('[aria-expanded]'))) b.setAttribute('aria-expanded', 'true');
        for (const r of Array.from(el.querySelectorAll('[role="region"]'))) r.removeAttribute('hidden');
        for (const c of Array.from(el.querySelectorAll('svg.transition-transform'))) c.classList.add('rotate-180');
      }
    }
  }
}

/** Asserts each live-only difference on the raw (not normalized) trees: the canvas is not live, the runtime is. Returns the kinds it saw. */
function assertLiveDifferences(runtime: Element, canvas: Element, layers: LayoutLayer[], where: string): LiveKind[] {
  const seen: LiveKind[] = [];
  for (const layer of layers) {
    if (!LIVE_TYPES.includes(layer.type)) continue;
    const rt = within(runtime, layer)[0];
    const cv = within(canvas, layer)[0];
    expect(rt, `${where} ${layer.id} on the runtime`).toBeDefined();
    expect(cv, `${where} ${layer.id} on the canvas`).toBeDefined();
    if (layer.type === 'RecordForm') {
      expect(rt.querySelectorAll('button[type="submit"]').length, `${where} ${layer.id} runtime has Save`).toBeGreaterThan(0);
      expect(cv.querySelectorAll('button[type="submit"]').length, `${where} ${layer.id} canvas has no Save`).toBe(0);
      seen.push('RecordForm');
    } else if (layer.type === 'Checklist') {
      const rtBoxes = Array.from(rt.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const cvBoxes = Array.from(cv.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      expect(cvBoxes.length, `${where} ${layer.id} same rows`).toBe(rtBoxes.length);
      if (rtBoxes.length > 0) {
        expect(rtBoxes.every((b) => !b.disabled), `${where} ${layer.id} runtime boxes are live`).toBe(true);
        expect(cvBoxes.every((b) => b.disabled), `${where} ${layer.id} canvas boxes are disabled`).toBe(true);
        seen.push('Checklist');
      }
    } else if (layer.type === 'QuickAdd') {
      const rtInput = rt.querySelector<HTMLInputElement>('input');
      const cvInput = cv.querySelector<HTMLInputElement>('input');
      expect(rtInput?.disabled, `${where} ${layer.id} runtime input`).toBe(false);
      expect(cvInput?.disabled, `${where} ${layer.id} canvas input`).toBe(true);
      expect(rt.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, `${where} ${layer.id} runtime Add`).toBe(false);
      expect(cv.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, `${where} ${layer.id} canvas Add`).toBe(true);
      const hintId = (cvInput?.getAttribute('aria-describedby') ?? '').split(/\s+/).find((t) => cv.querySelector(`[id="${t}"]`)?.textContent === HINT);
      expect(hintId, `${where} ${layer.id} canvas hint`).toBeDefined();
      expect(rt.textContent, `${where} ${layer.id} runtime has no hint`).not.toContain(HINT);
      seen.push('QuickAdd');
    } else {
      expect(rt.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'), `${where} ${layer.id} runtime starts closed`).toBe('false');
      expect(rt.querySelector('[role="region"]')?.hasAttribute('hidden'), `${where} ${layer.id} runtime region hidden`).toBe(true);
      expect(cv.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'), `${where} ${layer.id} canvas is open`).toBe('true');
      expect(cv.querySelector('[role="region"]')?.hasAttribute('hidden'), `${where} ${layer.id} canvas region shown`).toBe(false);
      seen.push('Collapsible');
    }
  }
  return seen;
}

function normalize(root: Element, surface: Surface, live: LayoutLayer[] = []): Element {
  const copy = root.cloneNode(true) as Element;
  if (live.length > 0) neutralizeLive(copy, live);
  if (surface === 'canvas') {
    for (const sel of REMOVE) for (const el of Array.from(copy.querySelectorAll(sel))) el.remove();
    for (const sel of UNWRAP) for (const el of Array.from(copy.querySelectorAll(sel))) unwrap(el);
  }
  return copy;
}

interface LinesOptions {
  /** The root itself is wrapper chrome (the canvas block of the page, the theme scope): only what it holds is listed. */
  inside?: boolean;
  /** Drop the CANVAS_ONLY attributes (the runtime body does this too when it is compared with the canvas). */
  bare?: boolean;
  /** Layers whose live-only differences are neutralized first (the canvas and the runtime body, never Preview against runtime). */
  live?: LayoutLayer[];
}

function lines(root: Element, surface: Surface, { inside = false, bare = surface === 'canvas', live = [] }: LinesOptions = {}): string[] {
  const copy = normalize(root, surface, live);
  const ids = new Map<string, number>();
  for (const el of Array.from(copy.querySelectorAll('[id]'))) ids.set(el.id, ids.size + 1);
  const out: string[] = [];
  const walk = (el: Element, depth: number): void => {
    const attrs = Array.from(el.attributes)
      .filter((a) => a.name !== 'class' && !(bare && DROP_ATTRS.has(a.name)))
      .map((a) => {
        let value = a.value;
        if (surface === 'preview' && a.name === 'href' && (value === PREVIEW_BASE || value.startsWith(`${PREVIEW_BASE}/`))) value = value.slice(PREVIEW_BASE.length) || '/';
        if (a.name === 'id') value = `#${ids.get(a.value) ?? '?'}`;
        else if (ID_REFS.includes(a.name)) value = value.split(/\s+/).map((v) => (ids.has(v) ? `#${ids.get(v)}` : v)).join(' ');
        return `${a.name}=${JSON.stringify(value)}`;
      })
      .sort();
    const cls = Array.from(el.classList).sort().join(' ');
    out.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${cls === '' ? '' : ` class="${cls}"`}${attrs.length === 0 ? '' : ` ${attrs.join(' ')}`}>`);
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1) walk(node as Element, depth + 1);
      else if (node.nodeType === 3 && (node.textContent ?? '').trim() !== '') out.push(`${'  '.repeat(depth + 1)}"${(node.textContent ?? '').replace(/\s+/g, ' ').trim()}"`);
    }
  };
  if (inside) for (const child of Array.from(copy.children)) walk(child, 0);
  else walk(copy, 0);
  return out;
}

// ---- Mounting ----
/** Lets the data promises and lazy parts settle: microtasks only, until the markup stops changing. */
async function settle(container: HTMLElement): Promise<void> {
  let last = '';
  for (let i = 0; i < 40; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    if (i >= 3 && container.innerHTML === last) return;
    last = container.innerHTML;
  }
  throw new Error('the page never settled');
}

const flat = (layout: LayoutLayer): LayoutLayer[] => [layout, ...(Array.isArray(layout.children) ? layout.children.flatMap(flat) : [])];

function pageUrl(spec: AppSpec, pageId: string, rows: Record<string, DataRow[]>): { route: string; recordId: string | null } {
  const recordSource = spec.pages.find((p) => p.id === pageId)?.sources.find((s) => s.mode === 'record');
  const first = recordSource === undefined || !Object.hasOwn(rows, recordSource.table) ? undefined : rows[recordSource.table][0]?.id;
  const recordId = typeof first === 'string' ? first : null;
  const route = routeFor(normalizeSpec(spec), pageId, recordId);
  if (route === null) throw new Error(`no route for ${pageId}`);
  return { route, recordId };
}

const queries = new QueryClient();
const Providers = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queries}>{children}</QueryClientProvider>;

/**
 * `built`: the route table of buildRuntimeModule, so RuntimeApp gets the props a built app gives it (the baked spec and the
 * Assistant and Settings buttons as menuTrail). Otherwise RuntimeApp with the props Preview gives SpecApp (no menuTrail).
 */
async function mountRuntime(ex: Example, pageId: string, built: boolean): Promise<{ root: HTMLElement; unmount(): void }> {
  const { route } = pageUrl(ex.spec, pageId, ex.rows);
  const routes = built
    ? buildRuntimeModule(ex.spec).routes
    : [{ path: '*', Component: () => createElement(RuntimeApp, { spec: ex.spec }) }];
  const view = render(
    <Providers>
      <MemoryRouter initialEntries={[route]}>
        <Suspense fallback={null}>
          <Routes>
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={createElement(r.Component)} />
            ))}
          </Routes>
        </Suspense>
      </MemoryRouter>
    </Providers>,
  );
  await settle(view.container);
  return { root: view.container, unmount: view.unmount };
}

async function mountPreview(ex: Example, pageId: string): Promise<{ root: HTMLElement; scope: HTMLElement; unmount(): void }> {
  const { route } = pageUrl(ex.spec, pageId, ex.rows);
  const status: PreviewStatus = { state: 'running', appId: APP_ID, revision: REVISION, startedAt: 'now', message: null, data: null };
  api.previewStatus.mockResolvedValue(status);
  const value = { record: { id: APP_ID }, spec: ex.spec, revision: REVISION, save: vi.fn(), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
  const chrome = { setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() };
  const view = render(
    <Providers>
      <MemoryRouter initialEntries={[joinPath(`/apps/${APP_ID}/preview`, route)]}>
        <StepChromeContext.Provider value={chrome}>
          <WorkspaceContext.Provider value={value}>
            <Routes>
              <Route path="/apps/:appId/preview/*" element={<PreviewTab />} />
            </Routes>
          </WorkspaceContext.Provider>
        </StepChromeContext.Provider>
      </MemoryRouter>
    </Providers>,
  );
  await settle(view.container);
  const scope = view.container.querySelector<HTMLElement>('[data-testid="preview-theme-scope"]');
  if (scope === null) throw new Error('the preview did not show the app');
  return { root: scope, scope, unmount: view.unmount };
}

async function mountCanvas(ex: Example, pageId: string, mode: 'light' | 'dark'): Promise<{ root: HTMLElement; scope: HTMLElement; unmount(): void }> {
  const page = ex.spec.pages.find((p) => p.id === pageId);
  if (page === undefined) throw new Error(pageId);
  const { recordId } = pageUrl(ex.spec, pageId, ex.rows);
  const data: CatalogData = { apiBase: '/api/preview', spec: ex.spec, pageId, recordId, dataSource: source.current as CatalogData['dataSource'] };
  const noop = vi.fn();
  const value = {
    tree: 'page',
    menu: null,
    menuPosition: 'top',
    root: page.layout,
    spec: ex.spec,
    page,
    ctx: partContextFor(ex.spec, page),
    library: libraryOf([]),
    data,
    selectedId: null,
    select: noop,
    drag: null,
    zones: new Set<string>(),
    sideZones: new Set<string>(),
    gridZones: new Set<string>(),
    gridHover: null,
    gridPreview: null,
    previewGrid: noop,
    resizing: null,
    previewResize: noop,
    pending: null,
    addHere: noop,
    beside: noop,
    settingsId: null,
    openSettings: noop,
    settingsFocus: null,
    appId: APP_ID,
    apply: (r: TreeResult): string | null => (r.ok ? null : r.message),
    askTable: noop,
    tell: noop,
    focusBlock: noop,
    announceGrid: noop,
    remove: noop,
    move: noop,
    otherPlaces: () => [],
    moveAcross: noop,
  } as unknown as DesignContextValue;
  const view = render(
    <Providers>
      <DesignContext.Provider value={value}>
        <DesignCanvas theme={ex.spec.theme} mode={mode} />
      </DesignContext.Provider>
    </Providers>,
  );
  await settle(view.container);
  const scope = view.container.querySelector<HTMLElement>('[data-testid="design-canvas"]');
  if (scope === null) throw new Error('no canvas scope');
  return { root: scope, scope, unmount: view.unmount };
}

/** The part drawn for the page root: on the runtime it is the element carrying the layer id. */
function runtimeBody(root: HTMLElement, layout: LayoutLayer): Element {
  const body = root.querySelector(`[data-layer-id="${layout.id}"]`);
  if (body === null) throw new Error(`the runtime drew no element for ${layout.id}`);
  return body;
}
/** On the canvas the root is the CanvasBlock of the page layout; after unwrapping its child is the part. */
function canvasBody(root: HTMLElement, layout: LayoutLayer): Element {
  const block = root.querySelector(`[data-canvas-block][data-layer-id="${layout.id}"]`);
  if (block === null) throw new Error(`the canvas drew no block for ${layout.id}`);
  return block;
}

beforeAll(async () => {
  // The runtime route is a lazy chunk: load it once here so the pages below only wait for microtasks.
  await import('@local-app-studio/runtime/runtime/RuntimeApp.jsx');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});
afterAll(() => vi.useRealTimers());
afterEach(cleanup);

const TOTAL_PAGES = EXAMPLE_IDS.reduce((n, id) => n + load(id).spec.pages.length, 0);
const livenessSeen = new Set<LiveKind>();
let pagesRun = 0;

describe('surface parity (P3): runtime, Preview and Design canvas draw one page', () => {
  it('finds all eight example apps', () => {
    expect(EXAMPLE_IDS).toHaveLength(8);
  });

  for (const id of EXAMPLE_IDS) {
    describe(id, () => {
      const ex = load(id);
      for (const page of ex.spec.pages) {
        it(`page ${page.id}: Preview equals the runtime, the canvas equals it after the named normalizations`, async () => {
          source.current = sampleDataSource(ex.rows, ex.spec);
          const layers = flat(page.layout);
          const where = `${id}/${page.id}`;

          // runtime: the route a built app mounts, and RuntimeApp with the props Preview gives SpecApp.
          const built = await mountRuntime(ex, page.id, true);
          const builtBody = runtimeBody(built.root, page.layout).cloneNode(true) as Element;
          const builtExact = lines(builtBody, 'runtime');
          const builtLive = lines(builtBody, 'runtime', { bare: true, live: layers });
          expect(built.root.querySelector('[aria-label="Assistant"]'), `${where} the built app carries the entry buttons`).not.toBeNull();
          expect(built.root.querySelector('a[aria-label="Settings"]'), `${where} the built app carries Settings`).not.toBeNull();
          built.unmount();
          const bare = await mountRuntime(ex, page.id, false);
          const bareLines = lines(bare.root, 'runtime', { inside: true });
          expect(bare.root.querySelector('[aria-label="Assistant"]'), `${where} without menuTrail there are no entry buttons`).toBeNull();
          expect(lines(runtimeBody(bare.root, page.layout), 'runtime'), `${where} the built app draws the page as Preview does`).toEqual(builtExact);
          bare.unmount();
          expect(builtExact.length, `${where} the page drew something`).toBeGreaterThan(1);

          // Preview: the real PreviewTab. It shows the app in the look of the spec in the mode the person chose (the default here).
          const preview = await mountPreview(ex, page.id);
          const previewLines = lines(preview.root, 'preview', { inside: true });
          const previewStyle = preview.scope.getAttribute('style');
          const mode = preview.scope.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light';
          preview.unmount();
          expect(previewLines, `${where} Preview equals the runtime (menu bar included)`).toEqual(bareLines);

          // canvas: the real DesignCanvas, in the same mode, over the same rows.
          const canvas = await mountCanvas(ex, page.id, mode);
          const block = canvasBody(canvas.root, page.layout);
          const canvasRaw = block.cloneNode(true) as Element;
          const canvasLines = lines(block, 'canvas', { inside: true, live: layers });
          expect(canvas.scope.getAttribute('style'), `${where} the canvas has Preview's theme scope`).toBe(previewStyle);
          expect(canvas.scope.getAttribute('data-theme-mode')).toBe(mode);
          canvas.unmount();
          expect(canvasLines, `${where} the canvas equals the runtime body after CANVAS_ONLY and LIVE_ONLY`).toEqual(builtLive);

          // The live-only differences are real and are the documented ones, on this page.
          for (const kind of assertLiveDifferences(builtBody, canvasRaw, layers, where)) livenessSeen.add(kind);
          pagesRun += 1;
        });
      }
    });
  }

  it('exercised every documented live-only difference at least once across the examples', () => {
    if (pagesRun < TOTAL_PAGES) return; // a filtered run (-t) did not visit every page
    expect(Array.from(livenessSeen).sort()).toEqual(LIVE_ONLY.map(([kind]) => kind).sort());
  });
});

describe('surface parity (P3): the comparison can fail', () => {
  it('sees a changed class, a changed attribute, a missing node and a changed text, and names no part as editor-only by accident', async () => {
    const ex = load('crew-board');
    source.current = sampleDataSource(ex.rows, ex.spec);
    const page = ex.spec.pages[0];
    const layers = flat(page.layout);
    const built = await mountRuntime(ex, page.id, true);
    const body = runtimeBody(built.root, page.layout).cloneNode(true) as Element;
    built.unmount();
    const canvas = await mountCanvas(ex, page.id, 'light');
    const block = canvasBody(canvas.root, page.layout);
    const base = lines(block, 'canvas', { inside: true, live: layers });
    expect(base).toEqual(lines(body, 'runtime', { bare: true, live: layers }));
    const mutate = (change: (root: Element) => void): string[] => {
      const copy = block.cloneNode(true) as Element;
      change(copy);
      return lines(copy, 'canvas', { inside: true, live: layers });
    };
    expect(mutate((r) => r.querySelector('h2')?.classList.add('italic'))).not.toEqual(base);
    expect(mutate((r) => r.querySelector('button')?.setAttribute('aria-pressed', 'true'))).not.toEqual(base);
    expect(mutate((r) => r.querySelector('button')?.remove())).not.toEqual(base);
    expect(mutate((r) => { const h = r.querySelector('h2'); if (h) h.textContent = 'Other'; })).not.toEqual(base);
    // Every part of the page is still drawn after the editor chrome is taken away: the page root is the first line.
    expect(base[0]).toContain('max-w-4xl');
    canvas.unmount();
  });
});

describe('surface parity (P3): one theme', () => {
  for (const id of EXAMPLE_IDS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${id} in ${mode}: the scope Studio draws and the variables a built app sets on <html> are the same`, async () => {
        const ex = load(id);
        source.current = sampleDataSource(ex.rows, ex.spec);
        const canvas = await mountCanvas(ex, ex.spec.pages[0].id, mode);
        const scoped = new Map<string, string>();
        for (const name of Array.from(canvas.scope.style)) if (name.startsWith('--')) scoped.set(name, canvas.scope.style.getPropertyValue(name));
        canvas.unmount();
        const root = document.documentElement;
        root.classList.toggle('light', mode === 'light');
        const theme = startRuntimeTheme(ex.spec.theme);
        const applied = new Map<string, string>();
        for (const name of Array.from(root.style)) if (name.startsWith('--')) applied.set(name, root.style.getPropertyValue(name));
        theme.stop();
        root.classList.remove('light');
        expect(scoped.size, 'the theme sets variables').toBeGreaterThan(10);
        expect(Object.fromEntries(applied)).toEqual(Object.fromEntries(scoped));
      });
    }
  }
});
