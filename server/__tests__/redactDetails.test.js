// ci:always-run
// redactText and redactDetails: secrets, e-mail, folders, paths, caps.
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { REDACTED, redactDetails, redactText, setRedactDataDir } from '../redact.js';

describe('redactText', () => {
  it('replaces secret-looking spans and e-mail addresses', () => {
    const out = redactText('key sk-abcdef123456 and Bearer abc.def, mail jo@example.com ok');
    expect(out).not.toMatch(/sk-abcdef|abc\.def|jo@example/);
    expect(out).toContain(REDACTED);
    expect(out).toContain('ok');
  });

  it('replaces the data folder, the home folder and other absolute paths', () => {
    const out = redactText('a C:\\Data\\App\\logs\\x.json b C:/Data/App/y c C:\\Other\\deep\\file.txt d', {
      dataDir: 'C:\\Data\\App',
      home: 'C:\\Nobody',
    });
    expect(out).toContain('<data>\\logs\\x.json');
    expect(out).toContain('<data>/y');
    expect(out).toContain('<path>/file.txt');
    expect(out).not.toMatch(/Other|deep/);
    expect(redactText('at C:\\Nobody\\proj\\a.js', { home: 'C:\\Nobody', dataDir: 'D:\\z' })).toBe('at <home>\\proj\\a.js');
    expect(redactText('see /Users/tester/work/a.txt now')).toBe('see <path>/a.txt now');
  });

  it('uses the configured data folder and the real home by default', () => {
    setRedactDataDir('C:\\Cfg\\Data');
    try {
      expect(redactText('C:\\Cfg\\Data\\app.db')).toBe('<data>\\app.db');
    } finally {
      setRedactDataDir('');
    }
    expect(redactText(`${os.homedir()}\\x`)).toContain('<home>');
  });

  it('caps long text with an ellipsis and never throws on odd input', () => {
    expect(redactText('a'.repeat(900), { max: 50 })).toBe(`${'a'.repeat(50)}...`);
    expect(redactText('a'.repeat(900)).length).toBe(503);
    expect(redactText(undefined)).toBe('undefined');
    const hostile = {
      toString() {
        throw new Error('x');
      },
    };
    expect(redactText(hostile)).toBe(REDACTED);
  });
});

describe('redactText folder patterns are reused', () => {
  it('gives the same answer on every call for the same data folder and home', () => {
    const opts = { dataDir: 'C:/data/app', home: 'D:/people/Pat' };
    const once = redactText('open C:/data/app/x.db and D:/people/Pat/y', opts);
    for (let i = 0; i < 5; i += 1) expect(redactText('open C:/data/app/x.db and D:/people/Pat/y', opts)).toBe(once);
    expect(once).toContain('<data>');
    expect(once).toContain('<home>');
  });
});

describe('redactDetails', () => {
  it('redacts by key and by text', () => {
    const out = redactDetails({ password: 'hunter2', note: 'at C:\\Users\\tester\\a\\b.js', n: 3, ok: true });
    expect(out.password).toBe(REDACTED);
    expect(out.note).toBe('at <path>/b.js');
    expect(out.n).toBe(3);
    expect(out.ok).toBe(true);
  });

  it('caps depth at 6, keys at 30 and array items at 20', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(JSON.stringify(redactDetails(deep))).toContain(REDACTED);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    const out = redactDetails(many);
    expect(Object.keys(out).filter((k) => k !== '_truncated')).toHaveLength(30);
    expect(out._truncated).toBe(true);
    expect(redactDetails({ list: Array.from({ length: 50 }, (_, i) => i) }).list).toHaveLength(20);
  });

  it('drops functions, Buffers and typed arrays', () => {
    const out = redactDetails({ f() {}, b: Buffer.from('abc'), u: new Uint8Array(3), keep: 'x' });
    expect(out).toEqual({ keep: 'x' });
  });

  it('wraps a non-object input and survives cycles', () => {
    expect(redactDetails('hello')).toEqual({ value: 'hello' });
    const loop = { a: 1 };
    loop.self = loop;
    expect(() => redactDetails(loop)).not.toThrow();
  });
});
