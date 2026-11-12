// @vitest-environment node
// B7 A7.4 (DESIGN-phase11.md 2.7): the client and the server must name an app the same way. 1000 seeded names go through the
// client deriveSlug (src/studio/lib/ids.ts) and the server deriveSlug (server/studio/specCheck.js); the rules that accept or
// refuse a name must agree too, and every accepted name must give a slug, an identifier and a starter spec that pass the schema.
import { describe, expect, it } from 'vitest';
import { IDENTIFIER_RE, SLUG_RE, WINDOWS_DEVICE_NAMES } from '@local-app-studio/runtime/spec/schema';
import { HOSTILE_STRINGS, chance, forSeeds, int, mulberry32, pick } from '@/test-utils/specFuzz';
import type { Rand } from '@/test-utils/specFuzz';
import { checkSpec, deriveIdentifier, deriveSlug as serverSlug, isValidAppName, starterSpec } from '../../../../server/studio/specCheck.js';
import { appNameProblem, deriveSlug as clientSlug } from '../ids';

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const DEVICE_WORDS = ['Con', 'aux', 'NUL', 'Com1', 'lpt9', 'Prn', 'COM0', 'Lpt0', 'Co', 'n', 'Au', 'x', 'Com', '1'];
const COMMON = ['Crew', 'Roster', 'App', 'Dev', 'Tool', 'Shed', 'Job', 'Log', 'Local', 'Studio', 'Console', 'Auxiliary'];

const word = (rand: Rand): string => {
  if (chance(rand, 0.15)) return pick(rand, DEVICE_WORDS);
  if (chance(rand, 0.25)) return pick(rand, COMMON);
  let out = LETTERS[int(rand, 0, LETTERS.length - 1)];
  for (let i = int(rand, 0, 9); i > 0; i -= 1) out += (LETTERS + DIGITS)[int(rand, 0, LETTERS.length + DIGITS.length - 1)];
  return out;
};

/** A name that follows the name rule on its face: 1 to 6 words of letters and digits, single spaces, 2 to 40 characters. */
function genName(rand: Rand): string {
  for (;;) {
    const words: string[] = [];
    for (let i = int(rand, 1, 6); i > 0; i -= 1) words.push(word(rand));
    const name = words.join(' ');
    if (name.length >= 2 && name.length <= 40 && /^[A-Za-z]/.test(name)) return name;
  }
}

/** Anything at all: hostile strings, odd spacing, dots, accents, long runs. */
function genAnything(rand: Rand): string {
  const base = chance(rand, 0.3) ? pick(rand, HOSTILE_STRINGS) : genName(rand);
  const twist = int(rand, 0, 6);
  if (twist === 0) return ` ${base}`;
  if (twist === 1) return `${base} `;
  if (twist === 2) return `${base}.`;
  if (twist === 3) return base.replace(' ', '  ');
  if (twist === 4) return `${base}é`;
  if (twist === 5) return base.repeat(int(rand, 1, 6)).slice(0, int(rand, 30, 60));
  return base;
}

describe('A7.4 the slug is the same everywhere', () => {
  it('client deriveSlug equals server deriveSlug for 1000 seeded names, and the slug is a safe folder name', () => {
    let devices = 0;
    forSeeds(1000, (seed) => {
      const name = genName(mulberry32(seed));
      const server = isValidAppName(name);
      // The client dialog and the server agree on which names are allowed.
      expect(appNameProblem(name) === null, `rule parity for ${JSON.stringify(name)}`).toBe(server);
      if (!server) {
        if (WINDOWS_DEVICE_NAMES.has(name.replaceAll(' ', '').toLowerCase())) devices += 1;
        return;
      }
      const slug = serverSlug(name);
      expect(clientSlug(name)).toBe(slug);
      expect(slug).toMatch(SLUG_RE);
      expect(slug.length).toBeLessThanOrEqual(40);
      expect(WINDOWS_DEVICE_NAMES.has(slug)).toBe(false);
      // The whole chain a new app takes holds together: the starter spec for this name passes the schema.
      const identifier = deriveIdentifier(slug);
      expect(identifier).toMatch(IDENTIFIER_RE);
      const checked = checkSpec(starterSpec(name, slug));
      expect(checked.ok, `${JSON.stringify(name)} -> ${slug}: ${JSON.stringify(checked.issues)}`).toBe(true);
    });
    expect(devices).toBeGreaterThan(10);
  });

  it('client and server agree on whether any string is an app name', () => {
    let accepted = 0;
    forSeeds(1000, (seed) => {
      const name = genAnything(mulberry32(seed + 5000));
      const server = isValidAppName(name);
      expect(appNameProblem(name) === null, `rule parity for ${JSON.stringify(name)}`).toBe(server);
      if (server) accepted += 1;
    });
    expect(accepted).toBeGreaterThan(100);
  });

  it('refuses every device name the same way on both sides, with or without spaces and in any case', () => {
    for (const device of WINDOWS_DEVICE_NAMES) {
      for (const name of [device, device.toUpperCase(), device[0].toUpperCase() + device.slice(1), [...device].join(' ')]) {
        expect(isValidAppName(name), name).toBe(false);
        expect(appNameProblem(name), name).toMatch(/reserved on Windows/);
      }
    }
  });
});
