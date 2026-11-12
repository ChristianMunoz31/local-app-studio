// The export surface of the pro seam: every seam's public stub and its pro twin export the same names, minus PRO_MARKER,
// so open code that imports a stub keeps working when a pro build swaps in the twin (docs/ARCHITECTURE.md, 'The pro seam').
// Read with acorn, so no module runs. The cloud provider seam is the one documented exception.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { PRO_SEAMS, REPO_ROOT } from '../../scripts/lib/proDir.js';

const HAS_PRO = fs.existsSync(path.join(REPO_ROOT, 'pro', 'server'));
// server/ai/providers/openaiCompat.js: the stub has the bytes of the cloud-off provider (the .disabled twin); the real
// provider also exports its marker constant and the URL builder the transport needs. Nothing else may differ.
const CLOUD_SEAM = 'server/ai/providers/openaiCompat.js';
const CLOUD_TWIN_EXTRAS = ['OPENAI_COMPAT_PROVIDER_MARKER', 'chatCompletionsUrl'];

/** @param {import('acorn').Node} node @returns {string[]} the names a binding pattern declares */
function patternNames(node) {
  switch (node.type) {
    case 'Identifier':
      return [node.name];
    case 'ObjectPattern':
      return node.properties.flatMap((p) => patternNames(p.type === 'RestElement' ? p.argument : p.value));
    case 'ArrayPattern':
      return node.elements.flatMap((e) => (e ? patternNames(e) : []));
    case 'AssignmentPattern':
      return patternNames(node.left);
    case 'RestElement':
      return patternNames(node.argument);
    default:
      throw new Error(`unexpected binding pattern ${node.type}`);
  }
}

const nameOf = (node) => (node.type === 'Identifier' ? node.name : String(node.value));

/**
 * @param {string} source module text
 * @returns {string[]} sorted export names ('default' for a default export)
 * @throws {Error} on `export * from`, whose names cannot be listed without loading the target
 */
export function exportNames(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = [];
  for (const node of ast.body) {
    if (node.type === 'ExportDefaultDeclaration') names.push('default');
    else if (node.type === 'ExportAllDeclaration') {
      if (!node.exported) throw new Error('export * from cannot be compared');
      names.push(nameOf(node.exported));
    } else if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d) {
        if (d.type === 'VariableDeclaration') names.push(...d.declarations.flatMap((v) => patternNames(v.id)));
        else names.push(d.id.name);
      }
      for (const s of node.specifiers) names.push(nameOf(s.exported));
    }
  }
  return [...new Set(names)].sort();
}

describe('exportNames (the acorn reader)', () => {
  it('reads every export form', () => {
    const src = [
      'export const A = 1, { B, c: C } = x, [D, ...E] = y;',
      'export function f() {}',
      'export async function* g() {}',
      'export class K {}',
      'const h = 1; const i = 2;',
      "export { h, i as 'j k' };",
      "export { z } from './z.js';",
      'export default function () {}',
      "export * as ns from './n.js';",
    ].join('\n');
    expect(exportNames(src)).toEqual(['A', 'B', 'C', 'D', 'E', 'K', 'default', 'f', 'g', 'h', 'j k', 'ns', 'z']);
  });

  it('refuses a bare export-star, which it cannot list', () => {
    expect(() => exportNames("export * from './a.js';")).toThrow(/cannot be compared/);
  });

  it('a type-only or empty module has no exports', () => {
    expect(exportNames('const a = 1;')).toEqual([]);
  });
});

describe.skipIf(!HAS_PRO)('stub and pro twin export the same names', () => {
  it.each(PRO_SEAMS)('%s', (seam) => {
    const stub = exportNames(fs.readFileSync(path.join(REPO_ROOT, seam), 'utf8'));
    const twinAll = exportNames(fs.readFileSync(path.join(REPO_ROOT, 'pro', seam), 'utf8'));
    expect(stub).not.toContain('PRO_MARKER');
    expect(twinAll).toContain('PRO_MARKER');
    const twin = twinAll.filter((n) => n !== 'PRO_MARKER');
    if (seam === CLOUD_SEAM) {
      const extra = twin.filter((n) => !stub.includes(n)).sort();
      expect(extra).toEqual([...CLOUD_TWIN_EXTRAS].sort());
      expect(stub.filter((n) => !twin.includes(n))).toEqual([]);
    } else {
      expect(twin).toEqual(stub);
    }
  });
});

describe.skipIf(HAS_PRO)('pro twins (skipped: this checkout has no pro/ folder, so there is no twin to compare)', () => {
  it('every stub is at its path and exports no marker', () => {
    for (const seam of PRO_SEAMS) {
      expect(exportNames(fs.readFileSync(path.join(REPO_ROOT, seam), 'utf8'))).not.toContain('PRO_MARKER');
    }
  });
});
