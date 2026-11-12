// The question before a save that deletes Preview data, shared by the Data and Design steps (DESIGN-phase13.md 3.4.3). Pure.
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { diffSpecs } from './specDiff';

/** The sentences of the changes from `before` to `after` that delete Preview data, in diff order. */
export function dataRemovals(before: AppSpec, after: AppSpec): string[] {
  return diffSpecs(before, after)
    .filter((c) => c.destructive)
    .map((c) => c.sentence);
}

export const REMOVE_DATA = {
  title: 'Save and remove data?',
  message: (sentences: readonly string[]): string => `These changes delete preview data: ${sentences.join(' ')}`,
  confirm: 'Save and remove',
  busy: 'Saving...',
  cancel: 'Keep editing',
  needsAnswer: 'These changes remove data, so they need your OK first.',
} as const;
