import type { Field, FieldType } from '@local-app-studio/runtime/spec/schema';

/** The plain-language type picker, in display order. */
export const FIELD_TYPE_CHOICES: ReadonlyArray<{ type: FieldType; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'longtext', label: 'Long text' },
  { type: 'integer', label: 'Number' },
  { type: 'real', label: 'Decimal' },
  { type: 'boolean', label: 'Yes or no' },
  { type: 'date', label: 'Date' },
  { type: 'datetime', label: 'Date and time' },
  { type: 'select', label: 'Choice' },
  { type: 'reference', label: 'Link to another table' },
];

/** The line under a field type picker: the two number types told apart (the option labels stay Number and Decimal). */
export const FIELD_TYPE_HINT = 'Number holds whole numbers. Decimal holds amounts like 12.50.';

/** The type words in a sentence ("a number field"), following the names of FIELD_TYPE_CHOICES (the Data step and the dialogs). */
export const FIELD_WORDS: Readonly<Record<FieldType, string>> = {
  text: 'text',
  longtext: 'long text',
  integer: 'number',
  real: 'decimal',
  boolean: 'yes or no',
  date: 'date',
  datetime: 'date and time',
  select: 'choice',
  reference: 'link',
};

/** A new type keeps id, label and required, drops the default and adds what the new type needs. */
export function changeFieldType(field: Field, type: FieldType, otherTables: Array<{ id: string }>): Field {
  const base = { id: field.id, label: field.label, required: field.required };
  switch (type) {
    case 'select':
      return { ...base, type, options: ['Option 1'] };
    case 'reference':
      return { ...base, type, table: otherTables[0]?.id ?? '' };
    case 'text':
    case 'longtext':
    case 'integer':
    case 'real':
    case 'boolean':
    case 'date':
    case 'datetime':
      return { ...base, type };
  }
}

/** What an unnamed field is called to a screen reader: its place in the table, or "Untitled field". */
export const UNTITLED_FIELD = 'Untitled field';
export const fieldName = (label: string, position: number | undefined): string =>
  label.trim() !== '' ? label : position === undefined ? UNTITLED_FIELD : `Field ${position}`;
