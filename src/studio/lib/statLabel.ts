// The default label of a Number tile: what it adds up, in words ("Sum of Amount", "Count of Jobs"). Pure.
import { LIMITS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';

const STAT_WORDS: Readonly<Record<string, string>> = { sum: 'Sum of', avg: 'Average of', min: 'Lowest', max: 'Highest' };

/** "Sum of <field label>" when the tile sums (or averages) a field, "Count of <table label>" when it counts. */
export function statLabel(stat: string, fieldLabel: string | undefined, tableLabel: string): string {
  const text = fieldLabel !== undefined && Object.hasOwn(STAT_WORDS, stat) ? `${STAT_WORDS[stat]} ${fieldLabel}` : `Count of ${tableLabel}`;
  return text.length > LIMITS.labelChars ? text.slice(0, LIMITS.labelChars).trimEnd() : text;
}

/** The label of the tile as it would be named for these settings, or null when it has no table. */
export function statLabelFor(spec: AppSpec, table: string | undefined, stat: unknown, field: unknown): string | null {
  const found = table === undefined ? undefined : spec.tables.find((t) => t.id === table);
  if (found === undefined) return null;
  const fieldId = typeof field === 'string' ? field : undefined;
  const fieldLabel = fieldId === undefined ? undefined : fieldId === 'created_at' ? 'Created' : fieldId === 'updated_at' ? 'Updated' : found.fields.find((f) => f.id === fieldId)?.label;
  return statLabel(typeof stat === 'string' ? stat : 'count', fieldLabel, found.label);
}
