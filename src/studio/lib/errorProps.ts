import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { isEmptyName, plainMessage } from './issueWords';

/**
 * The problems of one input in plain words, the same sentence once. `empty` replaces the sentences of a name with nothing in it.
 * Errors renders one paragraph per entry (ids `${id}-0`, `${id}-1`) and errorProps points at the same entries, so the two never drift.
 */
export function errorWords(issues: SpecIssue[], empty?: string): string[] {
  const all = issues.map((issue) => (empty !== undefined && isEmptyName(issue.message) ? empty : plainMessage(issue.message)));
  return all.filter((text, i) => all.indexOf(text) === i);
}

/** aria-invalid and aria-describedby for an input whose problems are shown with ids `${id}-0`, `${id}-1`, and so on (one per errorWords entry). */
export function errorProps(id: string, issues: SpecIssue[], empty?: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const words = errorWords(issues, empty);
  if (words.length === 0) return {};
  return { 'aria-invalid': true, 'aria-describedby': words.map((_, i) => `${id}-${i}`).join(' ') };
}
