// Phase 27 LOW: the unreachable `not_ready` branch left DesignSession (7e0a063). This pins what stays: every refusal reason of the
// layout tree is handled, a grid reason through GRID_REASONS (spoken at once), any other through the plain refusal line.
import { describe, expect, it } from 'vitest';

const FILES = import.meta.glob(['../DesignSession.tsx', '../../lib/layoutTree.ts'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const SESSION = FILES['../DesignSession.tsx'] ?? '';
const TREE = FILES['../../lib/layoutTree.ts'] ?? '';

/** The members of `export type TreeRefusal = | 'a' | 'b' ...;` read from the source. */
function refusalMembers(): string[] {
  const block = /export type TreeRefusal =([^;]+);/.exec(TREE)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The members of the GRID_REASONS set literal in DesignSession.tsx. */
function gridReasons(): string[] {
  const body = /const GRID_REASONS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(SESSION)?.[1] ?? '';
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('DesignSession refusals', () => {
  it('reads both sources', () => {
    expect(SESSION.length).toBeGreaterThan(0);
    expect(TREE.length).toBeGreaterThan(0);
    expect(refusalMembers().length).toBeGreaterThan(10);
  });

  it('has no not_ready member or branch', () => {
    expect(refusalMembers()).not.toContain('not_ready');
    expect(SESSION).not.toContain('not_ready');
  });

  it('sends exactly the grid refusals through GRID_REASONS, and each is a TreeRefusal member', () => {
    const members = refusalMembers();
    const grid = gridReasons();
    expect(grid.length).toBeGreaterThan(0);
    for (const reason of grid) expect(members, reason).toContain(reason);
    const expected = members.filter((m) => m.startsWith('grid_') || m === 'not_free');
    expect([...grid].sort()).toEqual([...expected].sort());
  });

  it('shows every other refusal through the plain line, and no reason is compared by name elsewhere', () => {
    const members = new Set(refusalMembers());
    // report(): the refusal is turned into plain words first, then only a grid reason is spoken at once.
    expect(SESSION).toMatch(/const message = plainMessage\(refusal\);[\s\S]*?GRID_REASONS\.has\(result\.reason\)/);
    expect(SESSION).toMatch(/setNotice\(\{ text: message, undo: false, problem: true \}\);\s*return message;/);
    // A reason named in a comparison must be a member (a stale name such as not_ready would be a dead branch).
    const named = [...SESSION.matchAll(/\.reason\s*(?:===|!==)\s*'([a-z_]+)'/g)].map((m) => m[1]);
    for (const reason of named) expect(members.has(reason), reason).toBe(true);
  });
});
