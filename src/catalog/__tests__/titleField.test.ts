// format.ts mirrors titleFieldOf of src/runtime/normalizeSpec.js (a pure catalog file cannot import runtime code under
// ADR-006), so this pins the two to the same answer.
import { describe, expect, it } from 'vitest';
import { titleFieldOf as catalogTitleField } from '@local-app-studio/runtime/catalog/parts/format.ts';
import { titleFieldOf as sharedTitleField } from '@local-app-studio/runtime/runtime/normalizeSpec.js';
import { titleFieldOf as serverTitleField } from '../../../server/spec/normalize.js';

const fields = [
  { id: 'n', type: 'integer' as const },
  { id: 'name', type: 'text' as const },
  { id: 'code', type: 'select' as const },
];

describe('titleFieldOf parity', () => {
  const cases = [
    { fields },
    { titleField: 'code', fields },
    { titleField: 'ghost', fields },
    { fields: [{ id: 'n', type: 'integer' as const }] },
    { titleField: 'ghost', fields: [{ id: 'n', type: 'integer' as const }] },
  ];
  it.each(cases.map((c, i) => [i, c] as const))('case %i gives one answer everywhere', (_i, table) => {
    expect(catalogTitleField(table)).toBe(sharedTitleField(table));
    expect(serverTitleField(table)).toBe(sharedTitleField(table));
  });

  it('prefers a real titleField, then the first text field, then the id', () => {
    expect(sharedTitleField({ titleField: 'code', fields })).toBe('code');
    expect(sharedTitleField({ titleField: 'ghost', fields })).toBe('name');
    expect(sharedTitleField({ fields: [{ id: 'n', type: 'integer' }] })).toBe('id');
  });
});
