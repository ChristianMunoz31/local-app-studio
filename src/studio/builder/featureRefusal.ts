// Which plain refusal a feature check gives: the validator's issues (or the server's) reduced to one of the client-only codes of
// src/errors/copy.studio.js, so the builder and a damaged import never show a path, a part id or a developer word (DESIGN-phase16.md 4.10).
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { errorWords } from '../lib/errorWords';

export type BuilderRefusalCode =
  | 'feature_name_needed'
  | 'feature_line_needed'
  | 'feature_is_empty'
  | 'feature_needs_slots'
  | 'feature_too_many_settings'
  | 'feature_too_big'
  | 'feature_holds_itself'
  | 'feature_check_failed';

/** The code of one issue. */
function codeOfIssue(issue: SpecIssue): BuilderRefusalCode {
  if (issue.path === 'label') return 'feature_name_needed';
  if (issue.path === 'description') return 'feature_line_needed';
  if (issue.path === 'params' && issue.code === 'invalid_feature') return 'feature_too_many_settings';
  if (issue.code === 'fragment_too_large' || issue.code === 'feature_too_deep') return 'feature_too_big';
  if (issue.code === 'feature_cycle') return 'feature_holds_itself';
  if (issue.code === 'unbound_slot') return 'feature_needs_slots';
  return 'feature_check_failed';
}

/** The order the codes are picked in when a record has several problems: the one a person can fix first. */
const PRIORITY: readonly BuilderRefusalCode[] = [
  'feature_name_needed',
  'feature_line_needed',
  'feature_needs_slots',
  'feature_too_many_settings',
  'feature_too_big',
  'feature_holds_itself',
  'feature_check_failed',
];

/** One code for the problems of a record. */
export function builderRefusal(issues: readonly SpecIssue[]): BuilderRefusalCode {
  const codes = new Set(issues.map(codeOfIssue));
  return PRIORITY.find((c) => codes.has(c)) ?? 'feature_check_failed';
}

/** The sentence and the next step of a code, as the table has them. */
export function refusalWords(code: BuilderRefusalCode): { sentence: string; action: string } {
  const { sentence, action } = errorWords({ code });
  return { sentence, action };
}

/** The unique sentences of every issue's code, in the order the issues come (the import refusal list). */
export function builderRefusalWords(issues: readonly SpecIssue[]): string[] {
  return [...new Set(issues.map((i) => refusalWords(codeOfIssue(i)).sentence))];
}
