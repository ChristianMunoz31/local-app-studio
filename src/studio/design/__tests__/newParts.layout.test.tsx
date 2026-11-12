// Split from newParts.test.tsx by describe block (phase 27): Columns, Row, the choice table and bind on drop. The mocks, builders and hooks are in newPartsHarness.tsx.
import { saves, openCrewPage, block, group, addPart, answerTable, openSettings, savedLayer, installNewPartsHooks } from './newPartsHarness';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { exampleCtx } from '@/catalog/__tests__/fixtures';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import * as z from 'zod';
import { getPartDefinition } from '@/catalog/definitions';
import { CHOICE_PROPS } from '../../lib/choiceProps';

installNewPartsHooks();

describe('Columns on the canvas', () => {
  it('draws the columns side by side, follows the width choice, and names each column by its place', async () => {
    await openCrewPage();
    addPart('Columns');
    expect(group('Column 1 of 2')).toBeTruthy();
    expect(group('Column 2 of 2')).toBeTruthy();
    expect(document.querySelector('[class*="md:grid-cols-2"]')).toBeTruthy();
    const dialog = openSettings('Columns');
    fireEvent.change(within(dialog).getByLabelText('Column widths'), { target: { value: 'wide-left' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(document.querySelector('[class*="md:grid-cols-[2fr_1fr]"]')).toBeTruthy());
    // Between the columns there is no drop zone of the Columns part itself, but each column takes parts.
    expect(document.querySelector('[data-zone^="columns_1:"]')).toBeNull();
  });

  it('adds a column, removes it again, and Undo brings it back', async () => {
    await openCrewPage();
    addPart('Columns');
    fireEvent.click(within(openSettings('Columns')).getByRole('button', { name: 'Add a column' }));
    expect(screen.getByText('Added Column 3.')).toBeTruthy();
    expect(group('Column 3 of 3')).toBeTruthy();

    fireEvent.click(within(openSettings('Column 3 of 3')).getByRole('button', { name: 'Remove this column' }));
    const status = screen.getByText('Removed Column 3.').closest<HTMLElement>('[role="status"]');
    if (status === null) throw new Error('no notice');
    expect(screen.queryByRole('group', { name: 'Column 3 of 3' })).toBeNull();
    expect(group('Column 2 of 2')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
    });
    expect(group('Column 3 of 3')).toBeTruthy();
  });

  it('disables Remove at two columns and Add at four', async () => {
    await openCrewPage();
    addPart('Columns');
    const two = openSettings('Column 1 of 2');
    expect((within(two).getByRole('button', { name: 'Remove this column' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(two).getByRole('button', { name: 'Close' }));
    for (let n = 3; n <= 4; n += 1) fireEvent.click(within(openSettings('Columns')).getByRole('button', { name: 'Add a column' }));
    const four = openSettings('Columns');
    expect((within(four).getByRole('button', { name: 'Add a column' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(openSettings('Column 4 of 4')).getByRole('button', { name: 'Remove this column' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('moves a part into the other column with Move to', async () => {
    await openCrewPage();
    addPart('Columns');
    // New columns start empty (P-28): put a Text part in the first one with its Add here.
    expect(within(group('Column 1 of 2')).queryAllByRole('group')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add here: Column 1 of 2, place 1' }));
    addPart('Text');
    const left = group('Column 1 of 2');
    const text = within(left).getAllByRole('group')[0];
    fireEvent.click(text);
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Move to...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Column 2 of 2, place 1' }));
    expect(screen.getByText('Moved Text to Column 2 of 2, place 1.')).toBeTruthy();
    expect(within(group('Column 1 of 2')).queryAllByRole('group')).toHaveLength(0);
    expect(within(group('Column 2 of 2')).getAllByRole('group')).toHaveLength(1);
  });

  it('starts with no Text part in any column (P-28)', async () => {
    await openCrewPage();
    addPart('Columns');
    expect(within(group('Column 1 of 2')).queryAllByRole('group')).toHaveLength(0);
    expect(within(group('Column 2 of 2')).queryAllByRole('group')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Add here: Column 2 of 2, place 1' })).toBeTruthy();
  });
});

describe('Row on the canvas', () => {
  it('puts a thin inline drop place at the side of each part, and an inline Add here', async () => {
    await openCrewPage();
    addPart('Row');
    const first = document.querySelector<HTMLElement>('[data-zone="row_1:0"]');
    const last = document.querySelector<HTMLElement>('[data-zone="row_1:2"]');
    expect(first?.className).toContain('inset-y-0');
    expect(last?.className).toContain('-right-2');
    expect(screen.getByRole('button', { name: 'Add here: Row, place 1' })).toBeTruthy();
    expect(document.querySelector('[class*="flex-wrap"]')).toBeTruthy();
  });
});

describe('the choice table', () => {
  /** The values of the zod enum behind a prop (through default and optional wrappers), or null when it is not an enum. */
  const enumValues = (schema: z.core.$ZodType): string[] | null => {
    let cursor: unknown = schema;
    for (let i = 0; i < 4; i += 1) {
      const node = cursor as { options?: unknown; def?: { innerType?: unknown } };
      if (Array.isArray(node.options)) return node.options.map(String);
      cursor = node.def?.innerType;
    }
    return null;
  };

  it('lists exactly the options of the own enum of each part, and no prop that is a slot or free text', () => {
    for (const [type, props] of Object.entries(CHOICE_PROPS)) {
      const shape = getPartDefinition(type)!.props(exampleCtx()).shape;
      for (const c of props) {
        expect(Object.hasOwn(shape, c.prop), `${type}.${c.prop}`).toBe(true);
        if (c.kind === 'choice') expect(c.options.map((o) => o.value), `${type}.${c.prop}`).toEqual(enumValues(shape[c.prop]));
        expect(/^[A-Z]/.test(c.label) && !/[_.]/.test(c.label), c.label).toBe(true);
      }
    }
  });
});

describe('bind on drop through Add (the audit findings B1 to B4, B7, B9)', () => {
  const saveAndRead = async (id: string): Promise<LayoutLayer> => {
    // The toolbar's Save comes first (a Form block has its own Save button).
    const save = (): HTMLButtonElement => screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement;
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(saves).toHaveLength(1));
    return savedLayer(id);
  };

  const badge = (id: string): string | null => block(id).querySelector('[data-connection-badge]')?.textContent?.replace(/\. Change table$/, '') ?? null;

  it('B2: a Form on the record page edits that record', async () => {
    await openCrewPage();
    addPart('RecordForm');
    const form = await saveAndRead('recordform_1');
    expect(form.props).toMatchObject({ table: 'crews', source: 'one_crew', mode: 'edit' });
    expect(form.props.fields).toBeUndefined();
    expect(badge('recordform_1')).toBe('Connected to Crews');
  });

  it('B1 and B7: a Quick add binds a table the page shows and says so in its hint', async () => {
    await openCrewPage();
    addPart('QuickAdd');
    const quick = await saveAndRead('quickadd_1');
    expect(quick.props.table).toBe('crews');
    expect(quick.props.placeholder).toBe('Add to Crews');
    expect(badge('quickadd_1')).toBe('Connected to Crews');
  });

  it('B4: a Timeline takes the list with a real date field, not created_at of the first list', async () => {
    await openCrewPage();
    addPart('Timeline');
    const timeline = await saveAndRead('timeline_1');
    expect(timeline.props).toMatchObject({ source: 'open_tasks', dateField: 'due' });
    expect(badge('timeline_1')).toBe('Connected to Tasks');
  });

  it('B7: a Chart and a Progress bar name the table instead of the example words', async () => {
    await openCrewPage();
    addPart('ProgressBar');
    expect(screen.getByRole('dialog', { name: 'Settings for Progress bar' })).toBeTruthy();
    answerTable('ProgressBar', 'open_crews');
    const progress = await saveAndRead('progressbar_1');
    expect(progress.props.label).not.toBe('Crews this season');
    expect(String(progress.props.label)).toMatch(/^(Crews|Tasks)$/);
    expect(progress.props.source).toBe('open_crews');
  });
});
