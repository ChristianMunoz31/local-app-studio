// Split from newParts.test.tsx by describe block (phase 27): each new part applies one choice, Page links pages. The mocks, builders and hooks are in newPartsHarness.tsx.
import { NEW_PARTS, saves, openCrewPage, block, addPart, addPartAnswered, openSettings, savedLayer, installNewPartsHooks } from './newPartsHarness';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { choiceKey, choicePropsOf } from '../../lib/choiceProps';
import { partLabel } from '../../showcase/entries';

installNewPartsHooks();

describe('the new parts on the canvas', () => {
  it.each(NEW_PARTS)('%s applies one choice', async (type) => {
    await openCrewPage();
    addPartAnswered(type);
    expect(block(`${type.toLowerCase()}_1`)).toBeTruthy();

    const dialog = openSettings(partLabel(type));
    const props = choicePropsOf(type);
    const first = props.find((c) => c.kind === 'choice' && c.when === undefined && c.dateGroupOnly !== true) ?? props.find((c) => c.kind === 'number');
    if (first === undefined) {
      fireEvent.click(within(dialog).getByRole('button', { name: /Cancel|Close/ }));
      return;
    }
    const input = within(dialog).getByLabelText(first.label) as HTMLSelectElement | HTMLInputElement;
    const chosen = first.kind === 'number' ? '25' : (first.options.find((o) => o.value !== input.value)?.value ?? '');
    fireEvent.change(input, { target: { value: chosen } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(savedLayer(`${type.toLowerCase()}_1`).props[first.prop]).toBe(first.kind === 'number' ? 25 : chosen);
    expect(choiceKey(first)).toBe(`props.${first.prop}`);
  });

  it('shows the pages of Page links only when it links to pages you choose', async () => {
    await openCrewPage();
    addPart('NavLinks');
    const dialog = openSettings('Page links');
    expect(within(dialog).queryByText('Pages')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Links to'), { target: { value: 'pages' } });
    const box = within(dialog).getByRole('checkbox', { name: 'Home' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(savedLayer('navlinks_1').props).toMatchObject({ show: 'pages', pages: ['home'] });
  });

});
