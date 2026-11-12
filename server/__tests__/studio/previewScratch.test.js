import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compileSpec } from '../../spec/compile.js';
import { starterSpec } from '../../studio/specCheck.js';
import { RESETTABLE, prepareScratch, resetScratch } from '../../studio/preview/scratch.js';

let root;
let dir;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-scratch-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  dir = path.join(root, crypto.randomUUID());
});

const withTable = (spec) => ({ ...spec, tables: [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }] });

describe('prepareScratch', () => {
  it('writes the spec, a data folder and the app-track migrations folder', () => {
    const spec = starterSpec('Crew Roster', 'crew-roster');
    const out = prepareScratch(dir, spec, root);
    expect(JSON.parse(fs.readFileSync(out.specPath, 'utf8'))).toEqual(spec);
    expect(fs.existsSync(out.dataDir)).toBe(true);
    expect(fs.existsSync(path.join(out.appMigrationsDir, '001_app.sql'))).toBe(true);
    expect(out.data).toEqual({ kept: false, reason: 'first_start' });
  });

  it('keeps data when only layouts change, and keeps it with a label change (no migration needed)', () => {
    const spec = withTable(starterSpec('Crew Roster', 'crew-roster'));
    const first = prepareScratch(dir, spec, root);
    const marker = path.join(first.dataDir, 'app.db');
    fs.writeFileSync(marker, 'data');
    const layoutOnly = structuredClone(spec);
    layoutOnly.pages[0].title = 'Start';
    expect(prepareScratch(dir, layoutOnly, root).data).toEqual({ kept: true, reason: 'unchanged' });
    const relabeled = structuredClone(spec);
    relabeled.tables[0].label = 'Crews 2';
    const out = prepareScratch(dir, relabeled, root);
    expect(out).toMatchObject({ data: { kept: true, reason: 'tables_updated' }, migrated: false });
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('adopts a phase 9 state when both hashes match, and clears when the compiled SQL changed', () => {
    const spec = withTable(starterSpec('Crew Roster', 'crew-roster'));
    const first = prepareScratch(dir, spec, root);
    const marker = path.join(first.dataDir, 'app.db');
    const statePath = path.join(dir, 'preview-state.json');
    const v2 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
    const createHash = sha(compileSpec(spec).createSql.replaceAll('\r\n', '\n'));
    fs.rmSync(path.join(dir, 'applied-spec.json'));
    fs.writeFileSync(statePath, JSON.stringify({ tablesHash: v2.tablesHash, createSqlHash: createHash }));
    fs.writeFileSync(marker, 'data');
    expect(prepareScratch(dir, spec, root).data).toEqual({ kept: true, reason: 'unchanged' });
    expect(fs.existsSync(marker)).toBe(true);
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).v).toBe(2);
    fs.writeFileSync(statePath, JSON.stringify({ tablesHash: v2.tablesHash, createSqlHash: 'old' }));
    expect(prepareScratch(dir, spec, root).data).toEqual({ kept: false, reason: 'tables_replaced' });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('writes the compiled 001_app.sql (LF) and its lock', () => {
    const spec = withTable(starterSpec('Crew Roster', 'crew-roster'));
    const out = prepareScratch(dir, spec, root);
    const sql = fs.readFileSync(path.join(out.appMigrationsDir, '001_app.sql'), 'utf8');
    const lock = JSON.parse(fs.readFileSync(path.join(out.appMigrationsDir, 'migrations.lock.json'), 'utf8'));
    expect(sql).toBe(compileSpec(spec).createSql.replaceAll('\r\n', '\n'));
    expect(sql).toContain('crews');
    expect(lock['001_app.sql']).toBe(crypto.createHash('sha256').update(sql).digest('hex'));
  });

  it('refuses a folder outside the root', () => {
    expect(() => prepareScratch(path.join(os.tmpdir(), 'elsewhere'), starterSpec('Crew Roster', 'crew-roster'), root)).toThrow(TypeError);
  });

  it('resetScratch removes only the RESETTABLE entries and refuses a folder outside the root', () => {
    prepareScratch(dir, withTable(starterSpec('Crew Roster', 'crew-roster')), root);
    fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'x');
    resetScratch(dir, root);
    for (const name of RESETTABLE) expect(fs.existsSync(path.join(dir, name))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'app-spec.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'sentinel.txt'))).toBe(true);
    expect(() => resetScratch(path.join(root, '..'), root)).toThrow(TypeError);
    expect(() => resetScratch(path.join(root, crypto.randomUUID(), '..', '..'), root)).toThrow(TypeError);
  });
});
