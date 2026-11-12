// src/runtime never imports editor code (the vendored editor, the Design canvas, the Features showcase, @dnd-kit) or zod: a built app must not load an editor chunk (ADR-001).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return /\.(js|jsx|ts|tsx)$/.test(e.name) ? [full] : [];
  });

describe('src/runtime imports', () => {
  it('has source files to scan', () => {
    expect(walk(ROOT).length).toBeGreaterThan(8);
  });

  it('use no editor code (vendor, Studio design and showcase, @dnd-kit) and no zod', () => {
    const hits = walk(ROOT).flatMap((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      return specs
        .filter(
          (s) =>
            s.includes('/vendor/') ||
            s.includes('studio/design') ||
            s.includes('studio/showcase') ||
            s.startsWith('@dnd-kit/') ||
            s === 'zod' ||
            s.startsWith('zod/'),
        )
        .map((s) => `${path.relative(ROOT, file)}: ${s}`);
    });
    expect(hits).toEqual([]);
  });
});
