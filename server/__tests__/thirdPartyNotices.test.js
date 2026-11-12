import { describe, expect, it } from 'vitest';
import {
  END_MARKER,
  START_MARKER,
  licenseText,
  nameFromLockPath,
  productionEntries,
  renderBlock,
  replaceGenerated,
  repositoryUrl,
} from '../../scripts/release/thirdPartyNotices.js';

describe('nameFromLockPath', () => {
  it('takes the part after the last node_modules', () => {
    expect(nameFromLockPath('node_modules/@scope/pkg')).toBe('@scope/pkg');
    expect(nameFromLockPath('node_modules/a/node_modules/b')).toBe('b');
  });
});

describe('productionEntries', () => {
  const lock = {
    packages: {
      '': { name: 'root' },
      'packages/runtime': { version: '1.0.0' },
      'node_modules/@local-app-studio/runtime': { link: true },
      'node_modules/zed': { version: '1.0.0', license: 'MIT' },
      'node_modules/alpha': { version: '2.0.0', license: 'ISC' },
      'node_modules/alpha/node_modules/dup': { version: '1.0.0' },
      'node_modules/dup': { version: '1.0.0' },
      'node_modules/dev-only': { version: '1.0.0', dev: true },
      'node_modules/dev-opt': { version: '1.0.0', devOptional: true },
    },
  };
  it('drops root, workspaces, links and dev entries, dedupes and sorts', () => {
    expect(productionEntries(lock).map((e) => `${e.name}@${e.version}`)).toEqual(['alpha@2.0.0', 'dup@1.0.0', 'zed@1.0.0']);
  });
  it('is stable for an empty lock', () => {
    expect(productionEntries({})).toEqual([]);
  });
});

describe('licenseText', () => {
  it('reads strings, legacy objects and arrays', () => {
    expect(licenseText(' MIT ')).toBe('MIT');
    expect(licenseText({ type: 'ISC', url: 'x' })).toBe('ISC');
    expect(licenseText([{ type: 'MIT' }, 'Apache-2.0'])).toBe('MIT OR Apache-2.0');
    expect(licenseText(undefined)).toBe('');
  });
});

describe('repositoryUrl', () => {
  it('normalizes the common shapes to https', () => {
    expect(repositoryUrl('github:a/b')).toBe('https://github.com/a/b');
    expect(repositoryUrl('a/b')).toBe('https://github.com/a/b');
    expect(repositoryUrl({ url: 'git+https://github.com/a/b.git' })).toBe('https://github.com/a/b');
    expect(repositoryUrl({ url: 'git://github.com/a/b.git#main' })).toBe('https://github.com/a/b');
    expect(repositoryUrl({ url: `git${'@'}github.com:a/b.git` })).toBe('https://github.com/a/b');
    expect(repositoryUrl('https://example.com/lib')).toBe('https://example.com/lib');
  });
  it('returns empty for nothing usable', () => {
    expect(repositoryUrl(undefined)).toBe('');
    expect(repositoryUrl('')).toBe('');
    expect(repositoryUrl({ url: 'file:///C:/x' })).toBe('');
  });
});

describe('renderBlock', () => {
  const entries = [
    { name: 'b', version: '1.0.0', license: 'MIT', repository: 'https://x/b' },
    { name: 'a', version: '1.0.0', license: 'ISC', repository: '' },
    { name: 'c', version: '1.0.0', license: '', repository: '' },
    { name: 'd', version: '1.0.0', license: 'MIT', repository: '' },
  ];
  const block = renderBlock(entries);
  it('counts, sorts and shows the license mix', () => {
    expect(block).toContain('4 packages');
    expect(block).toContain('MIT (2), ISC (1), UNKNOWN (1)');
    expect(block.indexOf('| a |')).toBeLessThan(block.indexOf('| b |'));
    expect(block).toContain('| a | 1.0.0 | ISC | - |');
  });
  it('is deterministic whatever the input order', () => {
    expect(renderBlock([...entries].reverse())).toBe(block);
  });
  it('holds no drive path', () => {
    expect(block).not.toMatch(/[A-Za-z]:\\/);
  });
});

describe('replaceGenerated', () => {
  it('replaces only the block between the markers', () => {
    const text = `intro\n${START_MARKER}\nold\n${END_MARKER}\noutro\n`;
    const out = replaceGenerated(text, 'new');
    expect(out).toBe(`intro\n${START_MARKER}\nnew\n${END_MARKER}\noutro\n`);
    expect(replaceGenerated(out, 'new')).toBe(out);
  });
  it('appends a marked block when there are no markers', () => {
    expect(replaceGenerated('intro\n', 'new')).toBe(`intro\n\n${START_MARKER}\nnew\n${END_MARKER}\n`);
  });
});
