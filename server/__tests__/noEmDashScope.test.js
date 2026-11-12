import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { isCheckedFile, scanFile } from '../../scripts/checks/noEmDash.js';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';

// Built from code points so this file holds neither character.
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

describe('noEmDash scope', () => {
  it('covers every owned text file type', () => {
    for (const f of ['src/studio/x.tsx', 'server/a.js', 'docs/A.md', 'README.md', '.github/workflows/ci.yml', 'src-tauri/tauri.conf.json', 'src-tauri/src/main.rs', 'scripts/x.sh', 'src/index.css', 'index.html', 'a.toml', 'q.sql']) {
      expect(isCheckedFile(f), f).toBe(true);
    }
  });

  it('skips vendored, lock, notice, binary and self files', () => {
    for (const f of ['src/vendor/a.tsx', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/checks/noEmDash.js', 'public/logo.png', 'src-tauri/icons/icon.ico']) {
      expect(isCheckedFile(f), f).toBe(false);
    }
  });

  it('reports a dash in a .md and a .ts fixture, em and en', () => {
    expect(scanFile('docs/a.md', `Hello ${EM} world`)).toHaveLength(1);
    expect(scanFile('src/a.ts', `const s = 'a ${EN} b'`)).toHaveLength(1);
    expect(scanFile('docs/a.md', `range 3${EN}5`)).toHaveLength(1);
  });

  it('scans markdown raw and reports literal dashes in code comments too', () => {
    expect(scanFile('src/a.ts', `// note ${EM}\nconst a = 1`)).toHaveLength(1);
    expect(scanFile('src/a.ts', `/* a ${EN} b */`)).toHaveLength(1);
    expect(scanFile('docs/a.md', `<!-- ${EM} -->`)).toHaveLength(1);
  });

  it('finds a literal dash after http:// in JSX text or after a regex with escaped slashes', () => {
    const slash = String.fromCharCode(92) + '/';
    expect(scanFile('src/a.tsx', `<p>see http://x.test ${EM} here</p>`)).toHaveLength(1);
    expect(scanFile('src/a.js', `const re = /a${slash}${slash}b/; const s = 'x ${EN} y'`)).toHaveLength(1);
    expect(scanFile('src/a.js', `const u = 'http://x.test'; const w = 'a${EM}b'`)).toHaveLength(1);
  });

  it('keeps entities and escapes in comments out of the report', () => {
    expect(scanFile('src/a.ts', '// &mdash; and the escape\nconst a = 1')).toEqual([]);
    expect(scanFile('src/a.tsx', '<p>a &mdash; b</p>')).toHaveLength(1);
  });

  it('tolerates escapes in tests only, still flags literals there', () => {
    const esc = String.fromCharCode(92) + 'u2014';
    expect(scanFile('src/__tests__/a.test.ts', `expect(x).not.toMatch(/${esc}/)`)).toEqual([]);
    expect(scanFile('src/a.ts', `const s = '${esc}'`)).toHaveLength(1);
    expect(scanFile('src/__tests__/a.test.ts', `const s = '${EM}'`)).toHaveLength(1);
  });

  it('finds zero dashes in the tracked tree', () => {
    const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'checks', 'noEmDash.js')], { encoding: 'utf8' });
    expect(out).toContain('check:em-dash ok');
  });
});
