// Static guard (like aiBoundary.test.js): the kit ships no Pro route, so no route file mounts requirePro and
// PRO_FEATURES has no used entry. Free AI routes (the assistant, page advice) are listed, so the split stays an
// explicit decision: a product that adds a Pro route lists it here and gates it with requirePro before requireAi.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRO_PRESENT = fs.existsSync(path.join(ROOT, 'pro', 'server', 'pro.js'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** AI routes that are intentionally free. */
const FREE_AI_ROUTES = [
  ['server/assistantAdvisorRoutes.js', '/api/assistant/advice'],
  ['server.js', '/api/assistant'],
  ['server.js', '/api/assistant/actions/:token'],
];
/** Route files the kit ships. */
const ROUTE_FILES = ['server.js', 'server/dataRoutes.js', 'server/assistantAdvisorRoutes.js'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const POST_ROUTE_RE = /\bapp\.post\(\s*'(\/api\/assistant[^']*)'/g;

describe('the kit ships no Pro route', () => {
  it('no route file mounts requirePro', () => {
    for (const file of ROUTE_FILES) expect(read(file), file).not.toMatch(/requirePro\(/);
  });

  it('every POST under /api/assistant is listed as free', () => {
    const known = new Set(FREE_AI_ROUTES.map((r) => r[1]));
    // Plain data writes that run no model are listed by hand.
    known.add('/api/assistant/conversations');
    const found = [];
    for (const file of ROUTE_FILES) {
      for (const m of read(file).matchAll(POST_ROUTE_RE)) found.push(m[1]);
    }
    for (const route of found) expect(known.has(route), `${route} is not listed in proRoutesBoundary.test.js`).toBe(true);
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it('the free AI routes are not behind requirePro', () => {
    for (const [file, route] of FREE_AI_ROUTES) {
      const m = read(file).match(new RegExp(`app\\.post\\('${escapeRe(route)}',\\s*([^\\n]*)`));
      expect(m, route).not.toBeNull();
      expect(m[1]).not.toMatch(/requirePro\(/);
    }
  });

  // The gate has a public stub (server/pro.js) and a pro twin (pro/server/pro.js): both register the same placeholder.
  it.each(['server/pro.js', ...(PRO_PRESENT ? ['pro/server/pro.js'] : [])])('PRO_FEATURES registers only the reserved placeholder, and no entry is used (%s)', (file) => {
    const pro = read(file);
    expect(pro).toMatch(/example_pro: Object\.freeze\(\{ used: false/);
    expect(pro).not.toMatch(/used: true/);
    expect((pro.match(/Object\.freeze\(\{ used: /g) ?? []).length).toBe(1);
  });

  it('the public gate reads nothing from the license module', () => {
    expect(read('server/pro.js')).not.toMatch(/from '\.\/license\//);
  });

  it.skipIf(!PRO_PRESENT)('only getEntitlements is read from the license module (the pro twin of the gate)', () => {
    const src = read('pro/server/pro.js');
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/license\/index\.js'/g)].map((m) => m[1].trim());
    expect(imports).toEqual(['getEntitlements']);
    expect(src.match(/from '\.\/license\//g)).toHaveLength(1);
  });
});
