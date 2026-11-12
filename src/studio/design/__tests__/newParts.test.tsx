// Split from newParts.test.tsx by describe block (phase 27): each new part added with Add shows plain rows. The mocks, builders and hooks are in newPartsHarness.tsx.
import { NEW_PARTS, openCrewPage, block, addPartAnswered, openSettings, installNewPartsHooks } from './newPartsHarness';
import { within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { choicePropsOf } from '../../lib/choiceProps';
import { partLabel } from '../../showcase/entries';

installNewPartsHooks();

describe('the new parts on the canvas', () => {
  it.each(NEW_PARTS)('%s is added with Add and shows plain rows', async (type) => {
    await openCrewPage();
    addPartAnswered(type);
    expect(block(`${type.toLowerCase()}_1`)).toBeTruthy();

    const dialog = openSettings(partLabel(type));
    for (const c of choicePropsOf(type)) {
      // The pages of a part that shows the app menu are not asked for, and the date step of a chart that groups by a plain field is not either.
      if (c.when !== undefined || c.dateGroupOnly === true) continue;
      expect(within(dialog).getByLabelText(c.label), c.label).toBeTruthy();
    }
    expect(dialog.textContent ?? '').not.toMatch(/props\.|className|[a-z]+_[a-z_]+/);
  });

});
