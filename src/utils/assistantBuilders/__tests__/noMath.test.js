// Product rule: AI summarizes, code calculates. Page builders hand the model final derived numbers
// (totals, counts, per-category values) as ready values and never phrase anything as a request to
// calculate.
import { describe, it, expect } from 'vitest';
import { buildHomeContext } from '../home';
import { buildSettingsContext } from '../settings';
import { buildFallbackContext } from '../fallback';

const MATH_INSTRUCTION = /\b(calculate|compute|add (?:up|together)|sum (?:up|of)|subtract|multiply|divide|tally|work out the|average (?:of|the))\b/i;

/** Every string key and value in the structure. */
function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allStrings(v, out);
    }
  }
  return out;
}
const expectNoInstructions = (ctx) => {
  const strings = allStrings(ctx);
  expect(strings.length).toBeGreaterThan(0);
  for (const s of strings) expect(s, s).not.toMatch(MATH_INSTRUCTION);
};

describe('page builders never ask the model to do math', () => {
  it('the guard regex does catch an instruction (not vacuous)', () => {
    expect(MATH_INSTRUCTION.test('please add up the totals')).toBe(true);
    expect(MATH_INSTRUCTION.test('total value in dollars')).toBe(false);
  });

  it.each([
    ['home', () => buildHomeContext({ sections: ['Apps', 'Features'] })],
    ['settings', () => buildSettingsContext({ themePreference: 'dark', advisorButton: true, autoAdvise: true })],
    ['fallback', () => buildFallbackContext({ routeName: 'apps', title: 'Apps' })],
  ])('%s hands over values, not instructions', (_label, build) => {
    expectNoInstructions(build());
  });
});
