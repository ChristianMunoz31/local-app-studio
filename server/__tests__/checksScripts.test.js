import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { scanText as scanEmDash, stripComments } from '../../scripts/checks/noEmDash.js';
import {
  scanText as scanPersonal,
  luhnValid,
  parseDenylist,
  loadDenylist,
  globToRegExp,
  parseAllowlist,
  allowStringsFor,
  scanPath,
  scanHashed,
  loadHashedDenylist,
  parseHashedDenylist,
} from '../../scripts/checks/personalData.js';
import { summarize, evaluate, toMarkdown } from '../../scripts/checks/bundleBudget.js';

const DASH = String.fromCharCode(0x2014);
const kinds = (text, opts) => scanPersonal(text, opts).map((f) => f.kind);

describe('noEmDash scanner', () => {
  it('flags a literal em dash in JSX text and strings, with line and column', () => {
    const src = `const a = 'ok'\nconst b = <p>Hello ${DASH} world</p>\nconst c = "x${DASH}y"`;
    const found = scanEmDash(src);
    expect(found.map((f) => [f.line, f.col])).toEqual([
      [2, 20],
      [3, 13],
    ]);
  });

  it('flags HTML entity and escape forms', () => {
    expect(scanEmDash('<p>a &mdash; b &#8212; c &#x2014; d</p>')).toHaveLength(3);
    expect(scanEmDash("const s = 'a\\u2014b'")).toHaveLength(1);
  });

  it('reports literal dashes in comments, but not entities or escapes there', () => {
    expect(scanEmDash('// &mdash; and &#8212; in a comment')).toEqual([]);
    const src = [
      `// note ${DASH} reported`,
      `/* block ${DASH}\n still block ${DASH} */`,
      `const x = <div>{/* jsx ${DASH} comment */}ok</div>`,
    ].join('\n');
    expect(scanEmDash(src).map((f) => f.line)).toEqual([1, 2, 3, 4]);
  });

  it('does not treat comment markers inside strings or templates as comments', () => {
    expect(scanEmDash(`const u = 'http://a.example/x ${DASH}'`)).toHaveLength(1);
    expect(scanEmDash('const t = `a // ' + DASH + ' ${x} b`')).toHaveLength(1);
    expect(scanEmDash('const t = `${f(`/* ' + DASH + '`)}`')).toHaveLength(1);
  });

  it('survives a lone apostrophe in JSX text without hiding later lines', () => {
    const src = `<p>don't stop</p>\n<p>bad ${DASH} text</p>`;
    expect(scanEmDash(src).map((f) => f.line)).toEqual([2]);
  });

  it('keeps offsets stable when stripping comments', () => {
    const src = 'a // c\nb';
    expect(stripComments(src)).toHaveLength(src.length);
  });

  it('passes clean text', () => {
    expect(scanEmDash('const a = 1 - 2 // minus\n<p>Plain - text</p>')).toEqual([]);
  });
});

describe('personalData scanner', () => {
  // Fixtures are built from parts at runtime so this file itself scans clean without an allowlist entry.
  const join = (...parts) => parts.join('');
  const winPath = (name) => join('C:', '\\Users', '\\', name);

  it('flags emails but allows reserved example domains', () => {
    expect(kinds(`mail ${join('jane.doe', '@', 'gmail.com')} now`)).toEqual(['email']);
    expect(kinds('a@example.com b@example.org c@example.net d@x.test e@x.invalid')).toEqual([]);
    expect(kinds('12345+abc@users.noreply.github.com')).toEqual([]);
  });

  it('does not mistake package versions or scoped names for emails', () => {
    expect(kinds('react@19.2.6 and @tanstack/react-query')).toEqual([]);
  });

  it('flags US phone numbers but allows fictional 555-01xx', () => {
    expect(kinds(`call ${join('(415) 867', '-5309')}`)).toEqual(['phone']);
    expect(kinds('call 415-555-0123')).toEqual([]);
  });

  it('flags valid-range SSNs only', () => {
    expect(kinds(`ssn ${join('123-45', '-6789')}`)).toEqual(['ssn']);
    expect(kinds('ssn 000-12-3456 and 900-12-3456')).toEqual([]);
  });

  it('flags Luhn-valid card numbers and ignores other long digit runs', () => {
    const card = join('4111', '1111', '1111', '1111');
    expect(luhnValid(card)).toBe(true);
    expect(luhnValid(join('4111', '1111', '1111', '1112'))).toBe(false);
    expect(kinds(`card ${join('4111', ' 1111', ' 1111', ' 1111')}`)).toEqual(['card']);
    expect(kinds(`id ${join('4111', '1111', '1111', '1112')}`)).toEqual([]);
    expect(kinds('zeros 0000000000000000')).toEqual([]);
  });

  it('flags home paths but allows placeholders and CI users', () => {
    expect(kinds([winPath('jane'), 'Documents'].join('\\'))).toEqual(['home-path']);
    expect(kinds(join('/Users', '/jane/work'))).toEqual(['home-path']);
    expect(kinds(join('/home', '/jane/work'))).toEqual(['home-path']);
    expect(kinds('/home/runner/work /home/node/app /home/<you>/x /Users/$USER/x')).toEqual([]);
    expect(kinds([winPath('<name>'), 'x'].join('\\'))).toEqual([]);
  });

  it('flags public IPv4 but allows private, loopback and documentation ranges', () => {
    expect(kinds(join('host 8.8.', '8.8'))).toEqual(['public-ip']);
    expect(kinds('127.0.0.1 10.1.2.3 172.16.0.1 192.168.1.1 0.0.0.0 192.0.2.5 198.51.100.7 203.0.113.9')).toEqual([]);
    expect(kinds('version 1.2.3.4.5 and 999.1.1.1')).toEqual([]);
  });

  it('matches denylist terms case-insensitively and never exposes them', () => {
    const found = scanPersonal('hello Zebrafoo there', { denylist: ['zebrafoo'] });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'denylist', termIndex: 0, line: 1, col: 7, match: null });
    expect(JSON.stringify(found)).not.toMatch(/zebrafoo/i);
  });

  it('exempts a denylist hit only inside a whole allowed string', () => {
    const opts = { denylist: ['ownerhandle'], allowStrings: ['OwnerHandle1'] };
    expect(kinds('owner OwnerHandle1 wrote this', { denylist: ['ownerhandle'] })).toEqual(['denylist']);
    expect(kinds('owner OwnerHandle1 wrote this', opts)).toEqual([]);
    expect(kinds('github.com/OwnerHandle1/repo and @OwnerHandle1', opts)).toEqual([]);
    expect(kinds('OwnerHandle12 or xOwnerHandle1', opts)).toEqual(['denylist', 'denylist']);
    expect(kinds('OwnerHandle1 and OwnerHandle', opts)).toEqual(['denylist']);
  });

  it('exempts only a whole home-path match, so a longer user name is still flagged', () => {
    const allowStrings = [join('Users', '\\sam'), join('/home', '/sam')];
    expect(kinds(winPath('sam'), { allowStrings })).toEqual([]);
    expect(kinds(join('/home', '/sam/x'), { allowStrings })).toEqual([]);
    expect(kinds(winPath('samantha'), { allowStrings })).toEqual(['home-path']);
    expect(kinds(join('/home', '/samantha'), { allowStrings })).toEqual(['home-path']);
    expect(kinds(winPath('sam') + ' ' + winPath('samantha'), { allowStrings })).toEqual(['home-path']);
  });

  it('exempts only a whole email match, so a longer local part is still flagged', () => {
    const allowStrings = [join('x', '@y.com')];
    expect(kinds(join('x', '@y.com'), { allowStrings })).toEqual([]);
    expect(kinds(join('max', '@y.com'), { allowStrings })).toEqual(['email']);
    expect(kinds(join('x', '@y.com.evil.io'), { allowStrings })).toEqual(['email']);
  });

  it('exempts a phone or card only when the whole match is allowed', () => {
    const phone = join('866-579', '-7172');
    expect(kinds(`call ${phone}`, { allowStrings: [phone] })).toEqual([]);
    expect(kinds(`call ${join('1 ', phone)}`, { allowStrings: [phone] })).toEqual(['phone']);
  });

  it('scopes per-path allowed strings to matching files', () => {
    const allow = parseAllowlist({
      strings: ['global'],
      perPath: [
        { path: 'src/**/__tests__/*.test.js', strings: ['scoped'] },
        { path: 42, strings: ['ignored'] },
      ],
    });
    expect(allow.paths).toEqual([]);
    expect(allowStringsFor(allow, 'src/a/__tests__/b.test.js')).toEqual(['global', 'scoped']);
    expect(allowStringsFor(allow, 'server/x.js')).toEqual(['global']);
  });

  it('finds denylist terms in file paths without returning the term', () => {
    expect(scanPath('docs/Zebrafoo-notes.md', ['zebrafoo'])).toEqual([{ termIndex: 0 }]);
    expect(scanPath('docs/notes.md', ['zebrafoo'])).toEqual([]);
  });

  it('loads the denylist from env, splitting on commas and newlines and dropping comments', () => {
    expect(parseDenylist('a, b\n# note\n\n c ')).toEqual(['a', 'b', 'c']);
    expect(loadDenylist({ env: { PERSONAL_DENYLIST: 'alpha\nbeta' }, file: 'does-not-exist' })).toEqual(['alpha', 'beta']);
    expect(loadDenylist({ env: {}, file: 'does-not-exist' })).toEqual([]);
  });

  it('converts allowlist globs', () => {
    expect(globToRegExp('docs/**').test('docs/a/b.md')).toBe(true);
    expect(globToRegExp('*.md').test('a/b.md')).toBe(false);
    expect(globToRegExp('server/__tests__/x.test.js').test('server/__tests__/x.test.js')).toBe(true);
  });

  describe('built-in hashed denylist', () => {
    // A synthetic term; its hash is injected as a parameter, never read from the shipped list.
    const term = 'zq-synthetic-term';
    const hashed = [{ length: term.length, sha256: createHash('sha256').update(term).digest('hex') }];

    it('flags a term as a substring, in any case, with its position and without returning the term', () => {
      const found = scanPersonal('see my-ZQ-Synthetic-Termination here', { hashedDenylist: hashed });
      expect(found).toEqual([{ line: 1, col: 8, kind: 'denylist', match: null, termIndex: 0 }]);
      expect(JSON.stringify(found)).not.toContain(term);
      expect(scanPersonal('zq synthetic term', { hashedDenylist: hashed })).toEqual([]);
      expect(scanPersonal('line one\nthe zq-synthetic-term', { hashedDenylist: hashed })[0]).toMatchObject({ line: 2, col: 5 });
    });

    it('honors allowed strings, scans paths, and numbers plaintext terms after the hashed ones', () => {
      expect(scanPersonal('x zq-synthetic-term y', { hashedDenylist: hashed, allowStrings: ['zq-synthetic-term'] })).toEqual([]);
      expect(scanPath('docs/ZQ-Synthetic-Term.md', [], hashed)).toEqual([{ termIndex: 0 }]);
      expect(scanPath('docs/other.md', [], hashed)).toEqual([]);
      const both = scanPersonal('zq-synthetic-term and zebrafoo', { hashedDenylist: hashed, denylist: ['zebrafoo'] });
      expect(both.map((f) => f.termIndex)).toEqual([0, 1]);
    });

    it('caches token results per list and ignores malformed entries', () => {
      expect(scanHashed('zq-synthetic-term zq-synthetic-term', hashed)).toHaveLength(2);
      expect(scanHashed('zq-synthetic-term', [])).toEqual([]);
      expect(parseHashedDenylist([{ length: 3, sha256: 'nothex' }, null, { length: 0, sha256: 'a'.repeat(64) }, { length: 3, sha256: 'A'.repeat(64) }])).toEqual([
        { length: 3, sha256: 'a'.repeat(64) },
      ]);
      expect(parseHashedDenylist('nope')).toEqual([]);
    });

    it('ships hashes only (an empty list is fine), and no listed term appears in plaintext in the scanner files', () => {
      const shipped = loadHashedDenylist();
      expect(Array.isArray(shipped)).toBe(true);
      const localFile = path.join(process.cwd(), '.personal-denylist');
      const local = fs.existsSync(localFile) ? parseDenylist(fs.readFileSync(localFile, 'utf8')) : [];
      const dir = path.join(process.cwd(), 'scripts', 'checks');
      const sources = [
        ...['personalData.js', 'personal-denylist.hashes.json', 'personal-data.allow.json'].map((name) => fs.readFileSync(path.join(dir, name), 'utf8')),
        fs.readFileSync(import.meta.filename, 'utf8'),
      ];
      for (const text of sources) {
        expect(scanPersonal(text, { hashedDenylist: shipped }).filter((f) => f.kind === 'denylist')).toEqual([]);
        if (local.length) expect(scanPersonal(text, { denylist: local }).filter((f) => f.kind === 'denylist')).toEqual([]);
      }
    });
  });
});

describe('bundleBudget', () => {
  const assets = [
    { name: 'index-a.js', gzipBytes: 2048 },
    { name: 'Page-b.js', gzipBytes: 1024 },
    { name: 'index-c.css', gzipBytes: 512 },
    { name: 'font.woff2', gzipBytes: 99999 },
  ];

  it('summarizes js and css gzip sizes in KiB', () => {
    expect(summarize(assets.filter((a) => /\.(js|css)$/.test(a.name)))).toEqual({
      totalJsGzipKb: 3,
      largestJsGzipKb: 2,
      totalCssGzipKb: 0.5,
    });
  });

  it('passes under budget and fails over it', () => {
    const measured = { totalJsGzipKb: 3, largestJsGzipKb: 2, totalCssGzipKb: 0.5 };
    expect(evaluate(measured, { totalJsGzipKb: 3, largestJsGzipKb: 2, totalCssGzipKb: 1 }).ok).toBe(true);
    const over = evaluate(measured, { totalJsGzipKb: 2.9, largestJsGzipKb: 2, totalCssGzipKb: 1 });
    expect(over.ok).toBe(false);
    expect(toMarkdown(over.rows)).toContain('OVER');
  });

  it('fails when a budget key is missing', () => {
    const measured = { totalJsGzipKb: 1, largestJsGzipKb: 1, totalCssGzipKb: 1 };
    expect(evaluate(measured, { totalJsGzipKb: 5 }).ok).toBe(false);
  });
});
