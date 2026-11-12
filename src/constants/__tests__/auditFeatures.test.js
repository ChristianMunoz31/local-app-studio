import { describe, expect, it } from 'vitest';
import { featureLabel } from '../auditFeatures';

describe('featureLabel', () => {
  it('labels the live features in plain words', () => {
    expect(featureLabel('data_import')).toBe('Data import');
    expect(featureLabel('data_export')).toBe('Data export');
    expect(featureLabel('assistant')).toBe('Assistant');
  });

  it('falls back to the raw id for unknown ids, including inherited object keys', () => {
    expect(featureLabel('brand_new_feature')).toBe('brand_new_feature');
    expect(featureLabel('toString')).toBe('toString');
  });
});
