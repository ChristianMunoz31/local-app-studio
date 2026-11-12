// Every word the Feature builder shows, in one place (the copy table of docs/DESIGN.md lists them). Constants only.
import { FEATURE_LIMITS } from '@/catalog/features';

export const SLOT_TABLE_WORDS = {
  title: 'Add a table slot',
  lead: 'The feature shows rows from this table. In an app, people pick their own table.',
  shownAs: 'Shown as',
  sample: 'Sample rows',
  add: 'Add slot',
  cancel: 'Cancel',
} as const;

export const FIELD_SLOT_WORDS = { title: 'Add a field slot', submit: 'Add slot' } as const;

export const PANEL_WORDS = {
  title: 'Slots',
  subtitle: 'What people fill in when they add this feature.',
  count: (n: number): string => `People can change ${n} of ${FEATURE_LIMITS.params} things.`,
  shownAs: 'Shown as',
  sample: 'Sample rows',
  yourFields: 'Your fields',
  usedBy: (parts: readonly string[]): string => `Used by: ${parts.join(', ')}`,
  notUsed: 'Not used yet',
  tick: 'Let people change these words',
  empty: 'No slots yet. Drop a part that shows records, then press Add a table slot.',
} as const;

export const SAVE_WORDS = {
  titleNew: 'Save feature',
  titleEdit: 'Save a new version',
  name: 'Name',
  line: 'What it is for, in one line',
  hint: 'The helper reads this line to know when to use it.',
  count: (n: number): string => `${n} of ${FEATURE_LIMITS.descriptionChars}`,
  save: 'Save feature',
  busy: 'Saving...',
  cancel: 'Cancel',
  tryFirst: 'Save the feature first. Then pick the app.',
} as const;

export const BUILDER_WORDS = {
  newTitle: 'New feature',
  editTitle: (name: string): string => `Edit ${name}`,
  documentNew: 'New feature, Local App Studio',
  documentEdit: (name: string): string => `Edit ${name}, Local App Studio`,
  subtitle: 'Put parts together once and use them in any app. The rows you see are sample rows.',
  back: 'Features',
  yourFeature: 'Your feature',
  tryIt: 'Try it in an app',
  save: 'Save feature',
  saved: (name: string): string => `Saved ${name}. It is in your features.`,
  damaged: 'This feature is damaged, so it cannot be opened in the builder.',
  oneRecord: 'This feature shows one record, so the builder cannot open it yet.',
  leaveUnsaved: 'Your changes to the words are not saved. Leave anyway?',
  cannotOpen: 'The builder cannot open this feature yet.',
  missing: 'That feature does not exist. It may have been deleted.',
  backToFeatures: 'Back to Features',
  renamedSlot: 'renamed the table slot',
  renamedField: 'renamed the field',
  switched: (from: string, to: string): string => `switched ${from} to ${to} sample rows`,
} as const;

export const RENAME_WORDS = {
  open: 'Change name and line',
  title: 'Change name and line',
  save: 'Save changes',
} as const;
