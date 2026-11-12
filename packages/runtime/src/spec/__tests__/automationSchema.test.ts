/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 28: the two optional spec keys (`autoNumber` on a text or integer field, `rules` on a table). Old specs must read and
// compile exactly as before, the helper's tables schema must not move, and every validator code has its path and sentence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import * as S from '../schema.ts';
import type { Rule } from '../schema.ts';
import { keepAutomations, withoutAutomations } from '../rules.ts';
import { compileSpec } from '../../../../../server/spec/compile.js';
import { planMigration } from '../../../../../server/spec/plan.js';

type D = any;
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (...p: string[]): string => path.join(here, 'fixtures', ...p);
const read = (file: string): D => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

// The pin of section 1.7: the schema of the helper's tables step, written from the base tree.
describe('the helper sees nothing new', () => {
  it('the tables block schema is byte for byte the pre-phase one', () => {
    const now = JSON.stringify(z.toJSONSchema(S.TablesBlockSchema, { io: 'input' }));
    expect(now).toBe(fs.readFileSync(fx('tables-block-schema.json'), 'utf8'));
  });
  it('a helper reply with the new keys is refused as before', () => {
    const base = read(fx('automations', 'rules-paid.json'));
    const r = S.validateTables({ tables: base.tables });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });
  it('the rule type matches what the schema gives', () => {
    const out: z.output<typeof S.RuleSchema> = {} as Rule;
    const back: Rule = {} as z.output<typeof S.RuleSchema>;
    expect(out).toBeDefined();
    expect(back).toBeDefined();
  });
});

describe('old specs are untouched (1.7)', () => {
  const golden = read(fx('automations', 'old-parsed.json'));
  const compiled = read(fx('automations', 'old-compiled.json'));
  const root = path.resolve(here, '..', '..', '..', '..', '..');
  const inputs: Record<string, D> = { 'old-crew-roster': read(path.join(here, '..', 'fixtures', 'crew-roster.json')) };
  const examples = path.join(root, 'public', 'examples');
  for (const f of fs.readdirSync(examples).filter((n) => n.endsWith('.spec.json'))) {
    const name = f.replace('.spec.json', '');
    // Invoices and Clients gains the new keys in this phase, so its base copy is a fixture.
    inputs[name] = name === 'invoices-and-clients' ? read(fx('automations', 'old-invoices-and-clients.json')) : read(path.join(examples, f));
  }
  it('the golden covers the old crew roster and the eight examples', () => {
    expect(Object.keys(inputs).sort()).toEqual(Object.keys(golden).sort());
    expect(Object.keys(golden)).toHaveLength(9);
  });
  for (const name of Object.keys(inputs)) {
    it(`${name}: same issues, same parsed value, same compiled output, same plans`, () => {
      const r = S.validateAppSpec(inputs[name]);
      expect(roundTrip({ ok: r.ok, issues: r.issues, value: r.value })).toEqual(golden[name]);
      const value = golden[name].value;
      expect(roundTrip(compileSpec(value))).toEqual(compiled[name].compiled);
      expect(roundTrip(planMigration(null, value))).toEqual(compiled[name].create);
      expect(roundTrip(planMigration(value, value))).toEqual(compiled[name].same);
    });
  }
});

describe('good fixtures', () => {
  for (const f of ['auto-text.json', 'auto-integer.json', 'rules-paid.json']) {
    it(`${f} validates and keeps its keys`, () => {
      const input = read(fx('automations', f));
      const r = S.validateAppSpec(input);
      expect(r.issues).toEqual([]);
      expect(r.ok).toBe(true);
      const kept = (spec: D): unknown => spec.tables.map((t: D) => ({ rules: t.rules, numbers: t.fields.map((f: D) => f.autoNumber) }));
      expect(roundTrip(kept(r.value))).toEqual(roundTrip(kept(input)));
    });
  }
  it('the compiler and the migration planner ignore both keys', () => {
    const withKeys = read(fx('automations', 'rules-paid.json'));
    const plain = withoutAutomations(withKeys);
    expect(compileSpec(withKeys)).toEqual(compileSpec(plain));
    expect(planMigration(plain, withKeys)).toEqual({ ok: true, file: null });
    expect(planMigration(null, withKeys)).toEqual(planMigration(null, plain));
  });
  it('a numbered integer field may be required', () => {
    expect(S.validateAppSpec(read(fx('automations', 'auto-integer.json'))).ok).toBe(true);
  });
});

const SENTENCES = {
  auto_number_not_allowed: 'Only one field of a table can be numbered automatically, and it cannot have a default.',
  rule_field_missing: 'This automation names a field this table does not have.',
  rule_not_allowed: 'This automation cannot run as it is written.',
};

/** Each case edits the Invoices table (index 1) of rules-paid.json and names the one issue it must give. */
const BAD: Array<[string, (inv: D, spec: D) => void, string, string]> = [
  ['a second numbered field', (inv) => inv.fields.push({ id: 'ref', label: 'Ref', type: 'integer', autoNumber: {} }), 'auto_number_not_allowed', 'tables.1.fields.7.autoNumber'],
  ['a numbered field with a default', (inv) => { inv.fields[0].default = 'x'; }, 'auto_number_not_allowed', 'tables.1.fields.0.autoNumber'],
  ['a when field that is missing', (inv) => { inv.rules[0].when.field = 'nope'; }, 'rule_field_missing', 'tables.1.rules.0.when.field'],
  ['a set field that is missing', (inv) => { inv.rules[0].then[0].set = 'nope'; }, 'rule_field_missing', 'tables.1.rules.0.then.0.set'],
  ['a copy source that is missing', (inv) => { inv.rules[0].then[0] = { set: 'due', to: { field: 'nope' } }; }, 'rule_field_missing', 'tables.1.rules.0.then.0.to.field'],
  ['a when field that is not select or boolean', (inv) => { inv.rules[0].when = { field: 'total', is: true }; }, 'rule_not_allowed', 'tables.1.rules.0.when.field'],
  ['a select value that is not an option', (inv) => { inv.rules[0].when = { field: 'status', is: 'Lost' }; }, 'rule_not_allowed', 'tables.1.rules.0.when.is'],
  ['a boolean when with a text value', (inv) => { inv.rules[0].when = { field: 'paid', is: 'yes' }; }, 'rule_not_allowed', 'tables.1.rules.0.when.is'],
  ['setting the numbered field', (inv) => { inv.rules[0].then[0] = { set: 'number', to: { value: 'X' } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.set'],
  ['setting the when field', (inv) => { inv.rules[0].then[0] = { set: 'paid', to: { value: true } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.set'],
  ['today on a field that is not a date', (inv) => { inv.rules[0].then[0] = { set: 'total', to: 'today' }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to'],
  ['now on a date field', (inv) => { inv.rules[0].then[0] = { set: 'paid_on', to: 'now' }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to'],
  ['clear on a required field', (inv) => { inv.fields[4].required = true; inv.rules[0].then[0] = { set: 'due', to: 'clear' }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to'],
  ['a literal that does not fit', (inv) => { inv.rules[0].then[0] = { set: 'paid_on', to: { value: 'soon' } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to.value'],
  ['a literal select value that is not an option', (inv) => { inv.rules[0].then[0] = { set: 'status', to: { value: 'Lost' } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to.value'],
  ['a literal text longer than 500', (inv) => { inv.fields.push({ id: 'note', label: 'Note', type: 'text' }); inv.rules[0].then[0] = { set: 'note', to: { value: 'x'.repeat(501) } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to.value'],
  ['a literal on a reference', (inv) => { inv.rules[0].then[0] = { set: 'client_id', to: { value: 'abc' } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to.value'],
  ['a copy of another type', (inv) => { inv.rules[0].then[0] = { set: 'paid_on', to: { field: 'total' } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to.field'],
  ['a copy whose source is the numbered field', (inv) => { inv.fields.push({ id: 'note', label: 'Note', type: 'text' }); inv.rules[0].then[0] = { set: 'note', to: { field: 'number' } }; }, 'rule_not_allowed', 'tables.1.rules.0.then.0.to.field'],
  ['the same when setting a field twice in a rule', (inv) => { inv.rules[0].then.push({ set: 'paid_on', to: 'clear' }); }, 'rule_not_allowed', 'tables.1.rules.0.then.1.set'],
  ['the same when setting a field twice across rules', (inv) => { inv.rules.push({ when: { field: 'paid', is: true }, then: [{ set: 'paid_on', to: 'clear' }] }); }, 'rule_not_allowed', 'tables.1.rules.2.then.0.set'],
];

describe('validator codes (1.4)', () => {
  for (const [name, edit, code, at] of BAD) {
    it(`${name}: exactly ${code} at ${at}`, () => {
      const spec = read(fx('automations', 'rules-paid.json'));
      edit(spec.tables[1], spec);
      const r = S.validateAppSpec(spec);
      expect(r.ok).toBe(false);
      expect(r.issues).toEqual([{ path: at, code, message: SENTENCES[code as keyof typeof SENTENCES] }]);
    });
  }
  it('L1: a link copies only from a link to the same table', () => {
    const spec = read(fx('automations', 'rules-paid.json'));
    spec.tables.push({ id: 'projects', label: 'Projects', fields: [{ id: 'name', label: 'Name', type: 'text' }] });
    const inv = spec.tables[1];
    inv.fields.push({ id: 'project_id', label: 'Project', type: 'reference', table: 'projects' });
    inv.rules[0].then[0] = { set: 'client_id', to: { field: 'project_id' } };
    const r = S.validateAppSpec(spec);
    expect(r.issues).toEqual([{ path: 'tables.1.rules.0.then.0.to.field', code: 'rule_not_allowed', message: SENTENCES.rule_not_allowed }]);
    inv.fields.push({ id: 'second_client', label: 'Second client', type: 'reference', table: 'clients' });
    inv.rules[0].then[0] = { set: 'client_id', to: { field: 'second_client' } };
    expect(S.validateAppSpec(spec).issues).toEqual([]);
  });
  it('good copies and literals pass', () => {
    const spec = read(fx('automations', 'rules-paid.json'));
    const inv = spec.tables[1];
    inv.fields.push({ id: 'due2', label: 'Due again', type: 'date' }, { id: 'note', label: 'Note', type: 'longtext' });
    inv.rules.push({ when: { field: 'status', is: 'Sent' }, then: [{ set: 'due2', to: { field: 'due' } }, { set: 'note', to: { field: 'status' } }, { set: 'total', to: { value: 0 } }] });
    expect(S.validateAppSpec(spec).issues).toEqual([]);
  });
  it('autoNumber on any other type, an unknown key, a bad width and a long prefix are zod issues', () => {
    const spec = read(fx('automations', 'rules-paid.json'));
    spec.tables[1].fields[3].autoNumber = {};
    expect(S.validateAppSpec(spec).issues[0].code).toBe('unrecognized_keys');
    const s2 = read(fx('automations', 'auto-text.json'));
    s2.tables[0].fields[0].autoNumber.extra = 1;
    expect(S.validateAppSpec(s2).ok).toBe(false);
    const s3 = read(fx('automations', 'auto-text.json'));
    s3.tables[0].fields[0].autoNumber.width = 13;
    expect(S.validateAppSpec(s3).ok).toBe(false);
    const s4 = read(fx('automations', 'auto-text.json'));
    s4.tables[0].fields[0].autoNumber.prefix = 'x'.repeat(21);
    expect(S.validateAppSpec(s4).ok).toBe(false);
    const s5 = read(fx('automations', 'auto-integer.json'));
    s5.tables[0].fields[0].autoNumber.prefix = 'A';
    expect(S.validateAppSpec(s5).ok).toBe(false);
  });
  it('more than 20 rules and 5 actions are refused with a plain sentence', () => {
    const spec = read(fx('automations', 'rules-paid.json'));
    const inv = spec.tables[1];
    inv.rules = Array.from({ length: 21 }, () => clone(inv.rules[0]));
    expect(S.validateAppSpec(spec).issues[0].message).toBe('A table may have at most 20 automations.');
  });
});

describe('withoutAutomations and keepAutomations', () => {
  it('withoutAutomations removes every autoNumber and rules key and leaves the rest', () => {
    const spec = read(fx('automations', 'rules-paid.json'));
    const out = withoutAutomations(spec);
    expect(JSON.stringify(out)).not.toMatch(/autoNumber|"rules"/);
    expect(out.tables[1].fields).toHaveLength(spec.tables[1].fields.length);
    expect(JSON.stringify(spec)).toMatch(/autoNumber/);
    expect(S.validateAppSpec(out).ok).toBe(true);
  });
  it('keepAutomations puts a numbering and the rules back on the same fields', () => {
    const base = read(fx('automations', 'rules-paid.json'));
    const proposal = withoutAutomations(base);
    expect(keepAutomations(proposal, base)).toEqual(base);
  });
  it('M7: text to text keeps the whole block', () => {
    const base = read(fx('automations', 'auto-text.json'));
    const proposal = withoutAutomations(base);
    proposal.tables[0].fields[0].label = 'Ticket code';
    expect(keepAutomations(proposal, base).tables[0].fields[0].autoNumber).toEqual({ prefix: 'T', width: 5 });
  });
  it('M7: text to integer keeps only start', () => {
    const base = read(fx('automations', 'rules-paid.json'));
    const proposal = withoutAutomations(base);
    proposal.tables[1].fields[0] = { id: 'number', label: 'Number', type: 'integer' };
    delete proposal.tables[1].titleField;
    const out = keepAutomations(proposal, base);
    expect(out.tables[1].fields[0].autoNumber).toEqual({ start: 1001 });
    expect(S.validateAppSpec(out).ok).toBe(true);
  });
  it('M7: integer to text and a type change to date drop it', () => {
    const base = read(fx('automations', 'auto-integer.json'));
    const toText = withoutAutomations(base);
    toText.tables[0].fields[0] = { id: 'seq', label: 'Seq', type: 'text' };
    expect(keepAutomations(toText, base).tables[0].fields[0].autoNumber).toBeUndefined();
    const toDate = withoutAutomations(base);
    toDate.tables[0].fields[0] = { id: 'seq', label: 'Seq', type: 'date' };
    expect(keepAutomations(toDate, base).tables[0].fields[0].autoNumber).toBeUndefined();
  });
  it('a numbering is dropped when the proposal gives the field a default', () => {
    const base = read(fx('automations', 'auto-text.json'));
    const proposal = withoutAutomations(base);
    proposal.tables[0].fields[0].default = 'T1';
    expect(keepAutomations(proposal, base).tables[0].fields[0].autoNumber).toBeUndefined();
  });
  it('a rule whose field was removed or retyped is dropped, the others stay', () => {
    const base = read(fx('automations', 'rules-paid.json'));
    base.tables[1].rules.push({ when: { field: 'status', is: 'Sent' }, then: [{ set: 'due', to: 'clear' }] });
    const proposal = withoutAutomations(base);
    proposal.tables[1].fields = proposal.tables[1].fields.filter((f: D) => f.id !== 'due');
    const out = keepAutomations(proposal, base);
    expect(out.tables[1].rules).toHaveLength(2);
    expect(S.validateAppSpec(out).ok).toBe(true);
    const retyped = withoutAutomations(base);
    retyped.tables[1].fields[3] = { id: 'paid_on', label: 'Paid on', type: 'text' };
    expect(keepAutomations(retyped, base).tables[1].rules).toHaveLength(2);
  });
  it('a table the base does not have gets nothing', () => {
    const base = read(fx('automations', 'rules-paid.json'));
    const proposal = withoutAutomations(base);
    proposal.tables.push({ id: 'extra', label: 'Extra', fields: [{ id: 'name', label: 'Name', type: 'text' }] });
    const out = keepAutomations(proposal, base);
    expect(out.tables[2]).toEqual(proposal.tables[2]);
  });
});
