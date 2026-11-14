// Pure parser tests (node project, no DOM): the token tree, the link rule and the bounded-work guarantees.
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from '../markdownParse';

const types = (nodes) => nodes.map((n) => n.t);
const firstInline = (md) => parseMarkdown(md)[0].c;

describe('safeHref', () => {
  it('allows http, https and mailto in any case', () => {
    expect(safeHref('http://a.test/x')).toBe('http://a.test/x');
    expect(safeHref('HTTPS://a.test')).toBe('HTTPS://a.test');
    expect(safeHref('MailTo:me@a.test')).toBe('MailTo:me@a.test');
  });

  it('rejects every other scheme, relative and protocol-relative forms', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\u0000script:alert(1)',
      '\u200bjavascript:alert(1)',
      'data:text/html,<script>1</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.com',
      '/relative',
      '#frag',
      'http://',
      'https:///x',
      'mailto:',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
  });

  it('returns the cleaned string it checked', () => {
    expect(safeHref('  http://a.test/x\t')).toBe('http://a.test/x');
  });
});

describe('inline syntax', () => {
  it('parses bold, italic, strikethrough and code', () => {
    const nodes = firstInline('a **b** *c* ~~d~~ `e`');
    expect(types(nodes)).toEqual(['text', 'strong', 'text', 'em', 'text', 'del', 'text', 'code']);
    expect(nodes[7].v).toBe('e');
  });

  it('nests emphasis the CommonMark way', () => {
    const [node] = parseInline('***both***');
    expect(node.t).toBe('em');
    expect(node.c[0].t).toBe('strong');
  });

  it('keeps intraword underscores and spaced stars as text', () => {
    expect(parseInline('snake_case_name 2 * 3 * 4')).toEqual([{ t: 'text', v: 'snake_case_name 2 * 3 * 4' }]);
  });

  it('does not treat single tildes as strikethrough', () => {
    expect(parseInline('about ~5 to ~10')).toEqual([{ t: 'text', v: 'about ~5 to ~10' }]);
  });

  it('handles hard and soft breaks and backslash escapes', () => {
    expect(types(parseInline('a  \nb'))).toEqual(['text', 'br', 'text']);
    expect(types(parseInline('a\\\nb'))).toEqual(['text', 'br', 'text']);
    expect(parseInline('a\nb')).toEqual([{ t: 'text', v: 'a\nb' }]);
    expect(parseInline('\\*not bold\\*')).toEqual([{ t: 'text', v: '*not bold*' }]);
  });

  it('decodes the common entities as text', () => {
    expect(parseInline('a &amp; b &lt;i&gt; &#65;')).toEqual([{ t: 'text', v: 'a & b <i> A' }]);
  });

  it('turns code spans literal', () => {
    expect(parseInline('`**x**` and ``a ` b``')).toEqual([
      { t: 'code', v: '**x**' },
      { t: 'text', v: ' and ' },
      { t: 'code', v: 'a ` b' },
    ]);
  });
});

describe('links', () => {
  it('parses inline links with a title and nested emphasis', () => {
    const [a] = parseInline('[**hi** there](https://a.test/x "title")');
    expect(a).toMatchObject({ t: 'a', href: 'https://a.test/x' });
    expect(types(a.c)).toEqual(['strong', 'text']);
  });

  it('allows balanced parentheses in a destination', () => {
    expect(parseInline('[w](https://a.test/x_(y))')[0].href).toBe('https://a.test/x_(y)');
  });

  it('parses angle and bare autolinks and trims trailing punctuation', () => {
    expect(parseInline('<https://a.test/p>')[0]).toMatchObject({ t: 'a', href: 'https://a.test/p' });
    const nodes = parseInline('see https://a.test/docs, and www.b.test.');
    const links = nodes.filter((n) => n.t === 'a');
    expect(links.map((l) => l.href)).toEqual(['https://a.test/docs', 'http://www.b.test']);
    expect(nodes[nodes.length - 1]).toEqual({ t: 'text', v: '.' });
  });

  it('does not nest an autolink inside a bracket label', () => {
    expect(parseInline('[see https://a.test]').some((n) => n.t === 'a')).toBe(false);
  });

  it('gives an unsafe destination a link node with a null href and only the label inside', () => {
    for (const md of [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x]( javascript:alert(1))',
      '[x](&#106;avascript:alert(1))',
      '[x](&#x6A;avascript:alert(1))',
      '[x](data:text/html;base64,AAAA)',
      '[x](vbscript:msgbox(1))',
      '[x](//evil.com)',
      '[x](/relative)',
      '[x]()',
    ]) {
      expect(parseInline(md), md).toEqual([{ t: 'a', href: null, c: [{ t: 'text', v: 'x' }] }]);
    }
  });

  it('leaves a destination with a tab inside as literal text, never a link', () => {
    const nodes = parseInline('[x](java\tscript:alert(1))');
    expect(nodes.some((n) => n.t === 'a')).toBe(false);
  });

  it('never gives any link an unsafe href', () => {
    const md = ['[a](javascript:1)', '[b](https://ok.test)', '<javascript:1>', '[c](data:x,y)', 'http://d.test/p'].join(' ');
    const walk = (nodes) => nodes.flatMap((n) => [n, ...(n.c ? walk(n.c) : [])]);
    for (const node of walk(parseInline(md)).filter((n) => n.t === 'a')) {
      expect(node.href === null || safeHref(node.href) === node.href).toBe(true);
    }
  });

  it('keeps an image as alt text with its href, never a link', () => {
    const [img] = parseInline('![a *b*](https://a.test/i.png)');
    expect(img).toEqual({ t: 'img', alt: 'a b', href: 'https://a.test/i.png' });
  });

  it('gives an image with an unsafe destination a null href', () => {
    expect(parseInline('![a](javascript:alert(1))')[0]).toEqual({ t: 'img', alt: 'a', href: null });
    expect(parseInline('![a](data:text/html;base64,AAAA)')[0]).toEqual({ t: 'img', alt: 'a', href: null });
  });

  it('never makes a link out of raw html', () => {
    const nodes = parseInline('<a href="javascript:alert(1)">x</a> <b>y</b>');
    expect(nodes.some((n) => n.t === 'a')).toBe(false);
    expect(nodes[0]).toEqual({ t: 'text', v: '<a href="javascript:alert(1)">x</a> <b>y</b>' });
  });
});

describe('blocks', () => {
  it('parses headings, rules, paragraphs and setext headings', () => {
    const tree = parseMarkdown('# One\n\ntext\nmore\n\n---\n\nTwo\n===\n\n### Three ###');
    expect(tree.map((b) => b.t)).toEqual(['h', 'p', 'hr', 'h', 'h']);
    expect(tree[0].level).toBe(1);
    expect(tree[3].level).toBe(1);
    expect(tree[4]).toMatchObject({ level: 3, c: [{ t: 'text', v: 'Three' }] });
  });

  it('parses fenced code with a language and keeps markup literal', () => {
    const [code] = parseMarkdown('```js\nconst a = "<b>**x**</b>";\n```');
    expect(code).toEqual({ t: 'code', lang: 'js', text: 'const a = "<b>**x**</b>";' });
    expect(parseMarkdown('~~~\nx\n~~~')[0]).toMatchObject({ t: 'code', lang: '', text: 'x' });
  });

  it('runs an unclosed fence to the end', () => {
    expect(parseMarkdown('```\na\nb')[0]).toMatchObject({ t: 'code', text: 'a\nb' });
  });

  it('drops an unsafe info string', () => {
    expect(parseMarkdown('```"><script>\nx\n```')[0].lang).toBe('');
  });

  it('parses tight bullet and numbered lists with nesting', () => {
    const [list] = parseMarkdown('- a\n- b\n  1. c\n  2. d\n- e');
    expect(list).toMatchObject({ t: 'list', ordered: false, tight: true });
    expect(list.items).toHaveLength(3);
    const nested = list.items[1].blocks[1];
    expect(nested).toMatchObject({ t: 'list', ordered: true, start: 1 });
    expect(nested.items).toHaveLength(2);
  });

  it('keeps the first number of an ordered list and marks blank-separated lists loose', () => {
    const [list] = parseMarkdown('3. a\n\n4. b');
    expect(list).toMatchObject({ ordered: true, start: 3, tight: false });
  });

  it('parses task items', () => {
    const [list] = parseMarkdown('- [x] done\n- [ ] open\n- plain');
    expect(list.items.map((i) => i.task)).toEqual([true, false, null]);
  });

  it('continues an item on a lazy line and ends a list at an unrelated block', () => {
    const tree = parseMarkdown('- a\nlazy\n\n> q');
    expect(tree.map((b) => b.t)).toEqual(['list', 'quote']);
    expect(tree[0].items[0].blocks[0].c).toEqual([{ t: 'text', v: 'a\nlazy' }]);
  });

  it('parses block quotes', () => {
    const [quote] = parseMarkdown('> one\n> two\n>\n> - x');
    expect(quote.t).toBe('quote');
    expect(quote.c.map((b) => b.t)).toEqual(['p', 'list']);
  });

  it('parses a table with alignment, padding short rows and escaped pipes', () => {
    const [table] = parseMarkdown('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 |\n| x \\| y | 4 | 5 | 6 |');
    expect(table.t).toBe('table');
    expect(table.aligns).toEqual(['left', 'center', 'right']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toHaveLength(3);
    expect(table.rows[0][2]).toEqual([]);
    expect(table.rows[1]).toHaveLength(3);
    expect(table.rows[1][0]).toEqual([{ t: 'text', v: 'x | y' }]);
  });

  it('needs a pipe: a lone dash line under text is a heading, not a table', () => {
    expect(parseMarkdown('a\n---')[0]).toMatchObject({ t: 'h', level: 2 });
  });

  it('lets a table interrupt a paragraph', () => {
    expect(parseMarkdown('intro\n| a | b |\n| - | - |\n| 1 | 2 |').map((b) => b.t)).toEqual(['p', 'table']);
  });

  it('shows raw html blocks as plain paragraphs', () => {
    const tree = parseMarkdown('<script>alert(1)</script>\n\n<div onclick="x()">hi</div>');
    expect(tree.map((b) => b.t)).toEqual(['p', 'p']);
    expect(tree[0].c).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
  });

  it('handles empty, null and CRLF input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown('a\r\nb\r\n\r\nc')).toHaveLength(2);
  });
});

describe('bounded work', () => {
  const quick = (build) => {
    const start = performance.now();
    const result = build();
    const ms = performance.now() - start;
    return { result, ms };
  };

  it.each([
    ['unmatched stars', () => '*a '.repeat(30000)],
    ['alternating delimiters', () => '*_'.repeat(30000)],
    ['unmatched brackets', () => '['.repeat(60000)],
    ['link openers', () => '[a](x'.repeat(20000)],
    ['image openers', () => '![a]('.repeat(20000)],
    ['backtick runs', () => Array.from({ length: 2000 }, (_, i) => '`'.repeat((i % 40) + 1) + 'a').join('')],
    ['angle brackets', () => '<a'.repeat(50000)],
    ['autolink schemes', () => 'http://'.repeat(20000)],
    ['spaces', () => `# ${' '.repeat(100000)}x`],
    ['pipes', () => '|'.repeat(50000)],
    ['table-like lines', () => '| a | b |\n'.repeat(5000)],
    ['dashes and markers', () => '- '.repeat(50000)],
    ['entities', () => '&#'.repeat(50000)],
    ['tildes', () => '~~a '.repeat(20000)],
  ])('parses %s quickly', (_name, make) => {
    const text = make();
    const { ms } = quick(() => parseMarkdown(text));
    expect(ms).toBeLessThan(2500);
  });

  it('parses a long mixed ReDoS-style paragraph quickly', () => {
    const text = `${'a'.repeat(50000)}${'*'.repeat(5000)}${'_'.repeat(5000)}[${'('.repeat(5000)}${' '.repeat(50000)}!`;
    const { ms } = quick(() => parseMarkdown(text));
    expect(ms).toBeLessThan(2500);
  });

  it('survives deep nesting without a stack overflow', () => {
    const quotes = `${'> '.repeat(5000)}x`;
    expect(() => parseMarkdown(quotes)).not.toThrow();
    const lists = Array.from({ length: 500 }, (_, i) => `${'  '.repeat(i)}- x`).join('\n');
    expect(() => parseMarkdown(lists)).not.toThrow();
    const emphasis = `${'*a '.repeat(2000)}${'a* '.repeat(2000)}`;
    expect(() => parseMarkdown(emphasis)).not.toThrow();
  });
});
