// Output clean-up: fixDollarAmounts, sanitizeModelText and the streaming sanitizer whose
// concatenated output must equal sanitizeModelText(whole) for ANY split of the input.
import { describe, expect, it } from 'vitest';
import { fixDollarAmounts, sanitizeModelText } from '../ai/textSanitize.js';
import { FORCE_RELEASE_CHARS, createStreamSanitizer, lastSafeCut } from '../ai/streamSanitizer.js';

describe('fixDollarAmounts', () => {
  it.each([
    ['$1234.5', '$1,234.50'],
    ['$1234', '$1,234'],
    ['$1,234.56', '$1,234.56'],
    ['$1234567.891', '$1,234,567.89'],
    ['$-50', '-$50'],
    ['-$50.5', '-$50.50'],
    ['$0.5', '$0.50'],
    ['$007', '$7'],
    ['spent $96.75 on tools', 'spent $96.75 on tools'],
    ['range $5-$10', 'range $5-$10'],
    ['ends with $5.', 'ends with $5.'],
  ])('%s -> %s', (input, output) => {
    expect(fixDollarAmounts(input)).toBe(output);
  });

  it('never adds a $ to bare numbers or touches malformed groups', () => {
    expect(fixDollarAmounts('1234.5 apples, 2026-10-04')).toBe('1234.5 apples, 2026-10-04');
    expect(fixDollarAmounts('$1,23 and $12,34')).toBe('$1,23 and $12,34');
  });

  it('leaves code spans alone', () => {
    expect(fixDollarAmounts('cost `$1234.5` vs $1234.5')).toBe('cost `$1234.5` vs $1,234.50');
    expect(fixDollarAmounts('```\nprice = $1234.5\n```\n$1234.5')).toBe('```\nprice = $1234.5\n```\n$1,234.50');
  });

  it('handles non-strings', () => {
    expect(fixDollarAmounts(null)).toBe('');
  });
});

describe('sanitizeModelText', () => {
  it('strips dashes and fixes dollars together', () => {
    expect(sanitizeModelText('Kitchen \u2014 $1234.5 this month')).toBe('Kitchen, $1,234.50 this month');
  });
});

// Deterministic pseudo-random splits so failures are reproducible.
function* splits(text, seeds = 40) {
  for (let seed = 1; seed <= seeds; seed += 1) {
    let x = seed * 9301 + 49297;
    const parts = [];
    let i = 0;
    while (i < text.length) {
      x = (x * 9301 + 49297) % 233280;
      const size = 1 + (x % 9);
      parts.push(text.slice(i, i + size));
      i += size;
    }
    yield parts;
  }
  yield [...text];
  yield [text];
}

const FIXTURES = [
  'Your tools spend is $1234.5 this month \u2014 that is up from $980.2 last month.',
  '- **Kitchen:** $96.75 across 3 visits\n- **Garage:** $1200 \u2013 on target\n- Net: $-45.10',
  'Try 7\u20138 items per box for a week \u2014 then compare. Full boxes cost $12.5 less.',
  'Use `npm run build` \u2014 then check `$PATH`.\n```js\nconst x = "$1234.5 \u2014 raw";\n```\nDone \u2014 $5.',
  '| Category | Amount |\n|---|---|\n| Kitchen | \u2014 |\n| Tools | $1200 |',
  '\u2014 Leading dash line\nNext line \u2013 trailing dash \u2014\nThe dates 2026-05-01 \u2013 2026-05-03 matter.',
  'Plain text with no money and no dashes at all, just words and spaces.',
  'Edge: $ alone, $$5, a lone ` backtick and \u2014 more words here after it.',
  `${'word '.repeat(150)}\u2014 tail $1234.5 end`,
];

describe('createStreamSanitizer invariant', () => {
  it.each(FIXTURES.map((f, i) => [i, f]))('fixture %i: concat(push) + flush === sanitizeModelText(whole)', (_i, text) => {
    const expected = sanitizeModelText(text);
    for (const parts of splits(text)) {
      const s = createStreamSanitizer();
      let out = '';
      for (const p of parts) out += s.push(p);
      out += s.flush();
      expect(out).toBe(expected);
    }
  });

  it('releases text progressively instead of holding everything to the end', () => {
    const s = createStreamSanitizer();
    const released = ['Hello ', 'there ', 'friend, ', 'how ', 'are ', 'you'].map((t) => s.push(t)).join('');
    expect(released.length).toBeGreaterThan(0);
    expect(released + s.flush()).toBe('Hello there friend, how are you');
  });

  it('force-releases a long run without a safe cut', () => {
    const s = createStreamSanitizer();
    const out = s.push('9'.repeat(FORCE_RELEASE_CHARS + 10));
    expect(out.length).toBe(FORCE_RELEASE_CHARS + 10);
  });

  it('enabled:false passes text through', () => {
    const s = createStreamSanitizer({ enabled: false });
    expect(s.push('a \u2014 b')).toBe('a \u2014 b');
    expect(s.flush()).toBe('');
  });

  it('never cuts after a dash, a digit, or inside a code span', () => {
    expect(lastSafeCut('one \u2014 two')).toBe(-1);
    expect(lastSafeCut('one two \u2014 three')).toBe(3);
    expect(lastSafeCut('$12 dollars')).toBe(-1);
    expect(lastSafeCut('`a b` c')).toBe(5);
    expect(lastSafeCut('`a b')).toBe(-1);
  });
});
