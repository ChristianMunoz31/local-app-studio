// Layer widths in plain words (docs/APP_SPEC.md "Layer sizing"): the Width setting's choices, the settings line, the
// status messages and the review summary. Pure, no React.
import type { LayerSizing, LayerWidth, ShareWidth } from '@local-app-studio/runtime/spec/sizing';

/** Choices of the Width setting, widest first. */
export const WIDTH_LABELS: Readonly<Record<LayerWidth, string>> = {
  full: 'Whole row',
  'three-quarters': 'Three quarters',
  'two-thirds': 'Two thirds',
  half: 'Half',
  third: 'A third',
  quarter: 'A quarter',
  fit: 'Only what it needs',
};

const PHRASE: Readonly<Record<LayerWidth, string>> = {
  full: 'the whole row',
  'three-quarters': 'three quarters of the row',
  'two-thirds': 'two thirds of the row',
  half: 'half the row',
  third: 'a third of the row',
  quarter: 'a quarter of the row',
  fit: 'only the space it needs',
};

export const widthPhrase = (w: LayerWidth): string => PHRASE[w];

const FILLS = 'fills the rest of the row';

/** The verb phrase: "takes half the row", "takes at least a third of the row and fills the rest", "fills the rest of the row". */
function takes(s: LayerSizing): string {
  if (s.width === 'full') return `takes ${PHRASE.full}`;
  if (!s.grow) return `takes ${PHRASE[s.width]}`;
  if (s.width === 'fit') return FILLS;
  return `takes at least ${PHRASE[s.width]} and fills the rest`;
}

const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** "Takes half the row", "Takes at least a third of the row and fills the rest", "Fills the rest of the row". */
export function sizingLine(s: LayerSizing): string {
  return capital(takes(s));
}

/** "Quick add now takes half the row.", "Quick add now fills the rest of the row.", "Quick add now takes the whole row." */
export function sizingChange(name: string, s: LayerSizing): string {
  return `${name} now ${takes(s)}.`;
}

/** "Table of records now takes two thirds of the row and Number tile a third of the row." */
export function pairChange(left: string, l: ShareWidth, right: string, r: ShareWidth): string {
  return `${left} now takes ${PHRASE[l]} and ${right} ${PHRASE[r]}.`;
}

/** '' for the whole row, ' (half the row)', ' (fills the rest of the row)' for grow. */
export function summarySuffix(s: LayerSizing): string {
  if (s.width === 'full') return '';
  return s.grow ? ` (${FILLS})` : ` (${PHRASE[s.width]})`;
}
