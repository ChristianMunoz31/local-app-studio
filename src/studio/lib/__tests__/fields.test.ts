import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '@local-app-studio/runtime/spec/schema';
import { FIELD_TYPE_CHOICES } from '../fields';

describe('FIELD_TYPE_CHOICES', () => {
  it('covers every field type exactly once', () => {
    expect(FIELD_TYPE_CHOICES.map((c) => c.type).sort()).toEqual([...FIELD_TYPES].sort());
  });
});
