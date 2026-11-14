// Rendering safety of the markdown renderer: model text can never become live markup, a script, an image
// request or a link outside http, https and mailto.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import MarkdownImpl from '../MarkdownImpl';

afterEach(cleanup);

const view = (md, props = {}) => render(<MarkdownImpl {...props}>{md}</MarkdownImpl>).container;
const hrefs = (c) => [...c.querySelectorAll('a')].map((a) => a.getAttribute('href'));
const noLiveMarkup = (c) => {
  expect(c.querySelector('script, img, iframe, object, embed, svg, style, form, [onerror], [onclick], [onload]')).toBeNull();
};

describe('MarkdownImpl markup', () => {
  it('renders the supported syntax with plain element names', () => {
    const c = view(
      '# H\n\npara **b** *i* ~~d~~ `c`\n\n1. one\n2. two\n\n- a\n- [x] t\n\n> q\n\n```js\nlet a;\n```\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n\n---',
    );
    for (const sel of ['h1', 'p', 'strong', 'em', 'del', 'p code', 'ol li', 'ul li', 'blockquote', 'pre code.language-js', 'table thead th', 'table tbody td', 'hr']) {
      expect(c.querySelector(sel), sel).not.toBeNull();
    }
    expect(c.querySelector('input[type="checkbox"]')).toBeChecked();
    expect(c.querySelector('th').style.textAlign).toBe('left');
    expect(c.querySelector('td:last-child').style.textAlign).toBe('right');
  });

  it('renders a tight list without paragraphs and a loose one with them', () => {
    expect(view('- a\n- b').querySelector('li p')).toBeNull();
    expect(view('- a\n\n- b').querySelector('li p')).not.toBeNull();
  });

  it('keeps an ordered list start', () => {
    expect(view('3. a\n4. b').querySelector('ol')).toHaveAttribute('start', '3');
  });
});

describe('MarkdownImpl XSS', () => {
  it('shows script tags and inline html as text', () => {
    const c = view('<script>alert(1)</script> and <img src=x onerror=alert(1)> and <b>bold</b>');
    noLiveMarkup(c);
    expect(c.querySelector('b')).toBeNull();
    expect(c.textContent).toContain('<script>alert(1)</script>');
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows raw html blocks as text', () => {
    const c = view('<div onclick="steal()">\n<iframe src="http://evil.test"></iframe>\n</div>\n\n<svg onload=alert(1)></svg>\n\n<!-- c -->');
    noLiveMarkup(c);
    expect(c.querySelector('div')).toBeNull();
    expect(c.textContent).toContain('<iframe src="http://evil.test"></iframe>');
  });

  it('shows html inside code spans, fences and table cells as text', () => {
    const c = view('`<script>x</script>`\n\n```html\n<img src=x onerror=1>\n```\n\n| a |\n| - |\n| <img src=x onerror=1> |');
    noLiveMarkup(c);
    expect(c.textContent).toContain('<img src=x onerror=1>');
  });

  it('escapes entity-encoded markup instead of parsing it', () => {
    const c = view('&lt;script&gt;alert(1)&lt;/script&gt; &#60;img src=x onerror=1&#62;');
    noLiveMarkup(c);
    expect(c.textContent).toContain('<script>alert(1)</script>');
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x]( javascript:alert(1))',
    '[x](java\tscript:alert(1))',
    '[x](java\nscript:alert(1))',
    '[x](&#106;avascript:alert(1))',
    '[x](&#x6A;avascript:alert(1))',
    '[x](&Tab;javascript:alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](vbscript:msgbox(1))',
    '[x](//evil.com)',
    '[x](\\javascript:alert(1))',
    '[x](<javascript:alert(1)>)',
    '[x]: javascript:alert(1)\n\n[x]',
  ])('renders no anchor for %j', (md) => {
    const c = view(md);
    expect(c.querySelector('a')).toBeNull();
    expect(c.innerHTML).not.toMatch(/href=["']?\s*javascript/i);
    noLiveMarkup(c);
  });

  it('shows the label of an unsafe link as plain text', () => {
    const c = view('click [**here**](javascript:alert(1)) now');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('click here now');
    expect(c.querySelector('strong')).toHaveTextContent('here');
  });

  it('keeps safe links with their exact destination', () => {
    const c = view('[a](http://a.test/x) [b](HTTPS://b.test) [c](mailto:me@c.test) https://d.test/p www.e.test <https://f.test>');
    expect(hrefs(c)).toEqual([
      'http://a.test/x',
      'HTTPS://b.test',
      'mailto:me@c.test',
      'https://d.test/p',
      'http://www.e.test',
      'https://f.test',
    ]);
  });

  it('never renders an image element, with or without disallowedElements', () => {
    for (const md of ['![a](javascript:alert(1))', '![alt text](http://x.test/i.png)', '![a](data:image/svg+xml,%3Csvg%20onload=alert(1)%3E)']) {
      const c = view(md);
      expect(c.querySelector('img')).toBeNull();
      noLiveMarkup(c);
      expect(view(md, { disallowedElements: ['img'], unwrapDisallowed: true }).textContent).toBe('');
    }
    noLiveMarkup(view('![a](data:image/svg+xml,<svg onload=alert(1)>)'));
    expect(view('![alt text](http://x.test/i.png)').textContent).toBe('alt text');
  });

  it('never sets inner html, even for hostile text', () => {
    const c = view('**<img src=x onerror=alert(1)>**\n\n- <script>1</script>\n\n> <iframe>\n\n# <svg onload=1>');
    noLiveMarkup(c);
    expect(c.querySelectorAll('*').length).toBeGreaterThan(0);
  });

  it('renders a long hostile input quickly', () => {
    const text = `${'*a '.repeat(20000)}\n\n${'[a](x'.repeat(10000)}\n\n${'<a'.repeat(20000)}\n\n${'_'.repeat(30000)}`;
    const start = performance.now();
    const c = view(text);
    expect(performance.now() - start).toBeLessThan(5000);
    noLiveMarkup(c);
  });
});

describe('MarkdownImpl props', () => {
  it('passes href only for safe links to a component override (none for an unsafe one)', () => {
    const seen = [];
    const A = ({ href, children }) => {
      seen.push(href);
      return <b data-x="1">{children}</b>;
    };
    const c = view('[ok](https://a.test) [bad](javascript:alert(1))', { components: { a: A } });
    expect(seen).toEqual(['https://a.test', undefined]);
    expect(c.querySelector('a')).toBeNull();
  });

  it('drops a disallowed element, or unwraps its children', () => {
    expect(view('# T\n\ntext', { disallowedElements: ['h1'] }).querySelector('h1')).toBeNull();
    expect(view('# T\n\ntext', { disallowedElements: ['h1'] }).textContent).toBe('text');
    const c = view('# T', { disallowedElements: ['h1'], unwrapDisallowed: true });
    expect(c.querySelector('h1')).toBeNull();
    expect(c.textContent).toBe('T');
  });

  it('ignores a component override that is not a function or tag name', () => {
    expect(view('**b**', { components: { strong: { evil: true } } }).querySelector('strong')).not.toBeNull();
  });

  it('renders nothing for empty or non-string children', () => {
    expect(view('').innerHTML).toBe('');
    expect(render(<MarkdownImpl>{undefined}</MarkdownImpl>).container.innerHTML).toBe('');
  });
});
