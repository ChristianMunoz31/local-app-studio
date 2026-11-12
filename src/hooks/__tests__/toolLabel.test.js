import { describe, expect, it } from 'vitest';
import { toolLabel } from '../useAssistant';

describe('toolLabel', () => {
  it('maps known tools to friendly labels', () => {
    expect(toolLabel('list_features')).toBe('Checking your features');
  });

  it('labels the runtime tools by verb, with or without the table suffix', () => {
    expect(toolLabel('describe_data')).toBe('Looking at your data');
    expect(toolLabel('list_records__crews')).toBe('Reading records');
    expect(toolLabel('list_records')).toBe('Reading records');
    expect(toolLabel('get_stats__crews')).toBe('Working out totals');
    expect(toolLabel('save_record__crews')).toBe('Preparing a change');
    expect(toolLabel('constructor__x')).toBe('Working on it');
    expect(toolLabel('__proto__')).toBe('Working on it');
  });

  it('falls back to a plain phrase for unknown tools, never raw snake_case', () => {
    expect(toolLabel('some_new_tool')).toBe('Working on it');
    expect(toolLabel('toString')).toBe('Working on it');
    expect(toolLabel(undefined)).toBe('Working on it');
  });
});
