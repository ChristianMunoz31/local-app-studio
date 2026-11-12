// The settings popover (DESIGN-phase12.md 2.4, UX-36, UX-47, UX-51): it opens with Enter or a double click on a part, starts with
// the name of the part as a visible heading, puts the content first and Width last, starts the focus in the first field and says
// "Apply changes the page. Save keeps it." once. A part that is not connected takes its table at once and says so in at most three
// places.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { featuresApi } from '../../services/studioApi';
import type { WorkspaceValue } from '../../types';
import DesignTab from '../../pages/DesignTab';

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

const CREW: LayoutLayer = layer('root', 'Page', {}, [
  layer('h1', 'Heading', { size: 'lg' }, 'Crew page'),
  layer('t1', 'DataTable', { source: 'open_crews', columns: ['name'] }),
  layer('b1', 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go home'),
]);

/** The crew page with no list of its own and two tables that fit: a Table of records dropped on it cannot choose for itself. */
const BARE: LayoutLayer = layer('root', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Crew page')]);

/** A Table of records on Home (which has the active Crews list) and a Tabs part: the parts with a row click, columns and Add a tab. */
const HOME: LayoutLayer = layer('root_home', 'Page', {}, [
  layer('dt', 'DataTable', { source: 'open_crews' }),
  layer('tabs1', 'Tabs', {}, [layer('tab_a', 'Tab', { label: 'First' }, []), layer('tab_b', 'Tab', { label: 'Second' }, [])]),
]);

function specOf(bare: boolean, home?: LayoutLayer): AppSpec {
  const input = exampleSpec(bare ? BARE : CREW);
  const withHome = home === undefined ? input : { ...input, pages: input.pages.map((p) => (p.id === 'home' ? { ...p, layout: home } : p)) };
  return AppSpecSchema.parse(bare ? { ...withHome, pages: withHome.pages.map((p) => (p.id === 'crew' ? { ...p, sources: [] } : p)) } : withHome);
}

function Workspace({ bare, home, children }: { bare: boolean; home?: LayoutLayer; children: ReactNode }) {
  const [current, setCurrent] = useState<AppSpec>(() => specOf(bare, home));
  const record = (revision: number, s: AppSpec) => ({ id: 'app-1', name: 'Crew Roster', slug: 'crew-roster', revision, spec: s, issues: [], createdAt: '', updatedAt: '' });
  const value: WorkspaceValue = {
    record: record(1, current),
    spec: current,
    revision: 1,
    save: async (next) => {
      setCurrent(next);
      return { ok: true, record: record(2, next) };
    },
    reload: async () => {},
    setDirty: () => {},
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

async function openHomePage(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace bare={false} home={HOME}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByRole('group', { name: 'Page canvas' });
}

async function openHomeWith(home: LayoutLayer): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace bare={false} home={home}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByRole('group', { name: 'Page canvas' });
}

async function openCrewPage(bare = false): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace bare={bare}>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Page');
  fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'crew' } });
  await screen.findByRole('group', { name: 'Page canvas' });
}

const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (!el) throw new Error(`no block ${id}`);
  return el;
};
const before = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }));
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('opening the settings', () => {
  it('opens with the Settings tool and names the part in a visible heading', async () => {
    await openCrewPage();
    fireEvent.click(block('h1'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Heading' });
    expect(within(dialog).getByRole('heading', { level: 3 }).textContent).toBe('Settings for Heading');
  });

  it('hangs from the right edge of its block, and anchors left when that would cross the left edge of the canvas', async () => {
    await openCrewPage();
    fireEvent.click(block('h1'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog').className).toContain('right-2');
    cleanup();
    // The portal box is unplaced at mount (no width) and 10 px wide at the canvas's left edge once placed; the popover is 320 px
    // wide, so right-anchored it would cross.
    const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 10, width, height: 10, x: left, y: 0, toJSON: () => ({}) });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'dialog') return rect(-300, 320);
      if (this.hasAttribute('data-chrome')) return rect(0, parseFloat(this.style.width) || 0);
      return rect(0, 10);
    });
    await openCrewPage();
    fireEvent.click(block('h1'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.className).toContain('left-2'));
    expect(dialog.className).not.toContain('right-2');
  });

  it('keeps the right anchor while the portal box is not placed yet (no width)', async () => {
    const rect = (width: number): DOMRect => ({ left: 0, right: width, top: 0, bottom: 10, width, height: 10, x: 0, y: 0, toJSON: () => ({}) });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'dialog' ? rect(320) : rect(0);
    });
    await openCrewPage();
    fireEvent.click(block('h1'));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog').className).toContain('right-2');
  });

  it('opens with Enter on a part, with the focus in its first field', async () => {
    await openCrewPage();
    block('h1').focus();
    fireEvent.keyDown(block('h1'), { key: 'Enter' });
    const dialog = screen.getByRole('dialog', { name: 'Settings for Heading' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Text')));
  });

  it('opens with a double click on a part', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('h1'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Heading' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Text')));
  });

  it('starts the focus in the List for a Table of records, and in What it does for a Button', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('t1'));
    const table = screen.getByRole('dialog', { name: 'Settings for Table of records' });
    await waitFor(() => expect(document.activeElement).toBe(within(table).getByLabelText('Table')));
    fireEvent.keyDown(table, { key: 'Escape' });
    fireEvent.doubleClick(block('b1'));
    const button = screen.getByRole('dialog', { name: 'Settings for Button' });
    await waitFor(() => expect(document.activeElement).toBe(within(button).getByLabelText('What it does')));
  });

  it('gives the focus back to the Settings tool when it closes', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('h1'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Settings' })));
  });
});

describe('what the popover holds, in order', () => {
  it('puts the table first, then the part, and Width last', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('t1'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Table of records' });
    const badge = dialog.querySelector('[data-connection-badge]');
    const list = within(dialog).getByLabelText('Table');
    const apply = within(dialog).getByRole('button', { name: 'Apply' });
    const width = within(dialog).getByLabelText('Width');
    expect(badge).not.toBeNull();
    expect(before(badge as Element, list)).toBe(true);
    expect(before(list, apply)).toBe(true);
    expect(before(apply, width)).toBe(true);
  });

  it('starts with the plain pill and one line for what the part does with the table', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('t1'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Table of records' });
    const pill = dialog.querySelector('[data-connection-badge]') as HTMLElement;
    expect(pill.tagName).toBe('SPAN');
    expect(pill.textContent).toMatch(/^Connected to /);
    expect(within(dialog).queryByRole('button', { name: /Change table/ })).toBeNull();
    const mode = within(dialog).getByText('It shows records.');
    expect(before(pill, mode)).toBe(true);
  });

  it('puts What it does before the words of a Button', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('b1'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Button' });
    expect(before(within(dialog).getByLabelText('What it does'), within(dialog).getByLabelText('Text'))).toBe(true);
    expect(before(within(dialog).getByLabelText('Text'), within(dialog).getByLabelText('Width'))).toBe(true);
  });

  it('says once what Apply and Save do, and that Width needs neither', async () => {
    await openCrewPage();
    fireEvent.doubleClick(block('h1'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Heading' });
    expect(within(dialog).getAllByText('Apply changes the page. Save keeps it.')).toHaveLength(1);
    expect(within(dialog).getByText('Width changes right away.')).toBeTruthy();
  });
});

describe('a part that is not connected', () => {
  const addUnconnectedTable = async (): Promise<HTMLElement> => {
    await openCrewPage(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    return screen.getByRole('dialog', { name: 'Settings for Table of records' });
  };

  it('says it in the box, in the popover and in the Save reason, and nowhere else', async () => {
    const dialog = await addUnconnectedTable();
    expect(dialog.querySelector('[data-indicator="needs_table"]')?.textContent).toBe('Needs a table');
    // The open page's own part is not a row of the connections list; the list shows only its Fix all button.
    const connections = screen.getByRole('region', { name: 'Data connections' });
    expect(within(connections).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(connections).getByRole('button', { name: 'Fix all' })).toBeTruthy();
    expect(screen.queryByText(/has no source/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const places = [
      document.querySelector('[data-not-connected]')?.textContent,
      screen.queryByText('Pick one below.')?.textContent,
      screen.queryByText('Connect the parts that need a table, or delete them, to save.')?.textContent,
    ];
    expect(places.every((p) => typeof p === 'string')).toBe(true);
    expect(screen.queryAllByText(/not connected/i).length).toBeLessThanOrEqual(3);
  });

  it('takes the table when it is picked, with no Apply, and Undo takes it away again', async () => {
    const dialog = await addUnconnectedTable();
    fireEvent.change(within(dialog).getByLabelText('Table'), { target: { value: '@new:crews' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(block('datatable_1').querySelector('[data-connection-badge]')?.textContent).toContain('Crews');
    const status = screen.getByText('Connected to Crews. Added a list of Crews to this page.').closest<HTMLElement>('[role="status"]');
    expect(status).not.toBeNull();
    fireEvent.click(within(status as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(block('datatable_1').querySelector('[data-not-connected]')).not.toBeNull();
  });
});

describe('words the Studio wrote follow the table (P17-13)', () => {
  const ADDS = (text: string): LayoutLayer => layer(`b_${text.length}`, 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, text);

  it('a Button named "Add to Crews" reads "Add to Tasks" once its Table is Tasks, and a Button with typed words keeps them', async () => {
    await openHomeWith(layer('root_home', 'Page', {}, [ADDS('Add to Crews'), ADDS('Join the crew now')]));
    for (const id of ['b_12', 'b_17']) {
      fireEvent.doubleClick(block(id));
      const dialog = screen.getByRole('dialog', { name: 'Settings for Button' });
      fireEvent.change(within(dialog).getByLabelText('Table'), { target: { value: 'tasks' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings for Button' })).toBeNull());
    }
    expect(block('b_12').textContent).toContain('Add to Tasks');
    expect(block('b_17').textContent).toContain('Join the crew now');
  });
});

describe('the settings of a list part and of Tabs (P-05, Columns, P-27)', () => {
  it('"When a row is clicked" offers the record page of the table, and keeps the choice after Apply', async () => {
    await openHomePage();
    fireEvent.doubleClick(block('dt'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Table of records' });
    const click = within(dialog).getByLabelText('When a row is clicked') as HTMLSelectElement;
    expect([...click.options].map((o) => o.textContent)).toEqual(['Does nothing', 'Opens Crew']);
    fireEvent.change(click, { target: { value: 'crew' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    fireEvent.doubleClick(block('dt'));
    const again = within(screen.getByRole('dialog', { name: 'Settings for Table of records' })).getByLabelText('When a row is clicked') as HTMLSelectElement;
    expect(again.value).toBe('crew');
  });

  it('Columns is one checkbox per field of the table; none ticked is the default and ticking is kept', async () => {
    await openHomePage();
    fireEvent.doubleClick(block('dt'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Table of records' });
    const group = within(dialog).getByRole('group', { name: 'Columns' });
    expect(within(group).getByText('Tick up to 8. With none ticked it shows the first five.')).toBeTruthy();
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Name' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    fireEvent.doubleClick(block('dt'));
    const kept = within(screen.getByRole('dialog', { name: 'Settings for Table of records' })).getByRole('group', { name: 'Columns' });
    expect((within(kept).getByRole('checkbox', { name: 'Name' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Tabs settings hold Add a tab, as Columns settings hold Add a column', async () => {
    await openHomePage();
    fireEvent.doubleClick(block('tabs1'));
    const dialog = screen.getByRole('dialog', { name: 'Settings for Tabs' });
    expect(within(dialog).queryByText('Nothing to set for this part.')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a tab' }));
    expect(screen.queryByRole('dialog', { name: 'Settings for Tabs' })).toBeNull();
    expect(screen.getByText('Added Tab 3.')).toBeTruthy();
    expect(document.querySelector('[data-layer-id="tab_1"]')).not.toBeNull();
  });
});
