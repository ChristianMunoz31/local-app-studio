import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { automationBullets, promptBullets } from '../promptBullets';

const withRule = (): AppSpec => {
  const spec = structuredClone(baseSpec());
  spec.tables[0].fields.push({ id: 'seen', label: 'Seen on', type: 'date', required: false });
  spec.tables[0].rules = [{ when: { field: 'status', is: 'paused' }, then: [{ set: 'seen', to: 'today' }] }];
  return spec;
};

describe('automationBullets', () => {
  it('says nothing when the two designs have the same automations', () => {
    expect(automationBullets(withRule(), withRule())).toEqual([]);
    expect(automationBullets(baseSpec(), baseSpec())).toEqual([]);
  });

  it('names an automation the proposal removed, by the saved design labels', () => {
    const after = withRule();
    delete after.tables[0].rules;
    expect(automationBullets(withRule(), after)).toEqual(['Automation removed: When Status becomes paused, set Seen on to today.']);
  });

  it('names an automation the proposal added', () => {
    const before = withRule();
    delete before.tables[0].rules;
    expect(automationBullets(before, withRule())).toEqual(['Automation added: When Status becomes paused, set Seen on to today.']);
  });

  it('names a field that gains or loses its numbering', () => {
    const numbered = structuredClone(baseSpec());
    const field = numbered.tables[0].fields[0];
    if (field.type !== 'text') throw new Error('text field expected');
    field.autoNumber = { prefix: 'C-' };
    expect(automationBullets(baseSpec(), numbered)).toEqual(['Numbered automatically: Name.']);
    expect(automationBullets(numbered, baseSpec())).toEqual(['No longer numbered automatically: Name.']);
  });

  it('puts the bullets in the review changes of an edit and never of a first design', () => {
    const after = withRule();
    delete after.tables[0].rules;
    const edit = promptBullets({ spec: after, before: withRule(), changes: [], needs: [] });
    expect(edit.changes).toEqual(['Automation removed: When Status becomes paused, set Seen on to today.']);
    expect(promptBullets({ spec: after, before: null, changes: [], needs: [] }).changes).toEqual([]);
  });
});
