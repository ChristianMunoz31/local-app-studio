import { describe, expect, it } from 'vitest';
import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { pathWords, plainIssue, plainMessage } from '../issueWords';

const spec = (): AppSpec => structuredClone(baseSpec());
// The glossary's never shown words (the same list as NEVER_SHOWN in e2e/pages/journey.js).
const NEVER_SHOWN = /\b(spec|AppSpec|JSON|schema|slot|source|undefined|specVersion|DataTable|SearchBox|QuickAdd|toolchain|rustc)\b/;
const issue = (path: string, message: string, code = 'x'): SpecIssue => ({ path, code, message });

describe('pathWords', () => {
  it('names an automation and the numbering of a field', () => {
    expect(pathWords('tables.0.rules.1.then.0.set', spec())).toBe('an automation of Crews');
    expect(pathWords('tables.0.rules.0.when.field')).toBe('an automation of 1');
    expect(pathWords('tables.0.fields.2.autoNumber', spec())).toBe('the numbering of Status');
    expect(pathWords('tables.0.fields.2.default', spec())).toBe('Table Crews, field Status');
  });

  it('names the app level places', () => {
    expect(pathWords('specVersion')).toBe('File version');
    expect(pathWords('app.name')).toBe('App name');
    expect(pathWords('app.slug')).toBe('File name');
    expect(pathWords('app.identifier')).toBe('Windows app name');
    expect(pathWords('app.version')).toBe('Version');
    expect(pathWords('menu.start.0.type')).toBe('Menu bar');
    expect(pathWords('menu')).toBe('Menu bar');
    expect(pathWords('theme.preset')).toBe('Look');
  });

  it('numbers tables and fields from one, or uses their labels when the design is known', () => {
    expect(pathWords('tables.0')).toBe('Table 1');
    expect(pathWords('tables.2.fields.0.id')).toBe('Table 3, field 1');
    expect(pathWords('tables.0.titleField', spec())).toBe('Table Crews');
    expect(pathWords('tables.0.fields.2.id', spec())).toBe('Table Crews, field Status');
    expect(pathWords('tables.5.fields.1', spec())).toBe('Table 6, field 2');
    expect(pathWords('tables.0.fields.9', spec())).toBe('Table Crews, field 10');
  });

  it('names pages, and a part inside a page layout', () => {
    expect(pathWords('pages.1')).toBe('Page 2');
    expect(pathWords('pages.0.route', spec())).toBe('Page Home');
    expect(pathWords('pages.0.layout', spec())).toBe('Page Home');
    expect(pathWords('pages.0.layout.children.0.props.size', spec())).toBe('Page Home, Heading');
    expect(pathWords('pages.0.layout.children.5.props.size', spec())).toBe('Page Home, a part');
    expect(pathWords('pages.0.layout.children.0.props.size')).toBe('Page 1, a part');
  });

  it('has no place for anything else', () => {
    expect(pathWords('(root)')).toBeNull();
    expect(pathWords('nav.0.label')).toBeNull();
    expect(pathWords('tables.x')).toBeNull();
    expect(pathWords('pages.x')).toBeNull();
    expect(pathWords('app.unknown')).toBeNull();
    expect(pathWords('')).toBeNull();
  });
});

describe('plainMessage', () => {
  it('says missing, wrong form, too short and too long', () => {
    expect(plainMessage('Invalid input: expected string, received undefined')).toBe('This is missing.');
    expect(plainMessage('Invalid input: expected array, received undefined')).toBe('This is missing.');
    expect(plainMessage('Required')).toBe('This is missing.');
    expect(plainMessage('Invalid input: expected 1')).toBe('This has the wrong form.');
    expect(plainMessage('Invalid input: expected object, received string')).toBe('This has the wrong form.');
    expect(plainMessage('Too small: expected string to have >=2 characters')).toBe('This needs at least 2 characters.');
    expect(plainMessage('Too small: expected string to have >=12 characters')).toBe('This needs at least 12 characters.');
    expect(plainMessage('Too big: expected string to have <=40 characters')).toBe('This is too long.');
  });

  it('says what a feature needs filled in by its label, never an id (P17-07)', () => {
    expect(plainMessage('Feature "status_board" needs a value for "things_to_track_by_statu" (Things to track by Status).')).toBe('Fill in Things to track by Status.');
    expect(plainMessage('Feature "k" needs a value for "a" (Words (short)).')).toBe('Fill in Words (short).');
  });

  it('says a name with the wrong shape in plain words, without the pattern (P17-09)', () => {
    const shaped = plainMessage('Invalid string: must match pattern /^[^s]+$/u');
    expect(shaped).toBe('This cannot start or end with a space, or hold a hidden character.');
    expect(shaped).not.toMatch(/pattern/);
  });

  it('says a part needs a table (the Design and Data wording)', () => {
    expect(plainMessage('DataTable: this page has no source "open_crews". Use one of: crews_list.')).toBe(
      'This part needs a table. Press Connect on it.',
    );
    expect(plainMessage('StatCard: this page has no source "x". Use one of: none.')).toBe('This part needs a table. Press Connect on it.');
  });

  it('turns the menu bar refusals into plain lists', () => {
    expect(plainMessage('The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.')).toBe(
      'The menu bar takes buttons, links, search boxes, quick adds, text and rows.',
    );
    expect(plainMessage('A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.')).toBe(
      'A row in the menu bar can only hold: Button, Link, Search box, Quick add and Text.',
    );
  });

  it('gives the allowed children by their plain labels', () => {
    expect(plainMessage('Columns can only hold: Column.')).toBe('Columns can only hold: Column.');
    expect(plainMessage('Tabs can only hold: Tab.')).toBe('Tabs can only hold: Tab.');
    expect(plainMessage('DataTable can only hold: RecordList, StatCard.')).toBe('Table of records can only hold: List of records, Number tile.');
  });

  it('replaces any remaining part type name by its label and leaves other words alone', () => {
    expect(plainMessage('QuickAdd needs a list source, but "x" is a record source.')).toBe('Quick add needs a list source, but "x" is a record source.');
    expect(plainMessage('RecordForm: table "crews" has no field "zzz".')).toBe('Form: table "crews" has no field "zzz".');
    expect(plainMessage('PageHeader and SearchBox are fine')).toBe('Page header and Search box are fine');
    // not a part type, or a single capital: untouched
    expect(plainMessage('MadeUpThing is not known')).toBe('MadeUpThing is not known');
    expect(plainMessage('Heading is fine')).toBe('Heading is fine');
  });

  it('passes an unknown sentence through unchanged', () => {
    expect(plainMessage('Layer id "a" is used twice on this page.')).toBe('Layer id "a" is used twice on this page.');
    expect(plainMessage('Parts may nest at most 12 levels deep.')).toBe('Parts may nest at most 12 levels deep.');
    expect(plainMessage('')).toBe('');
  });
});

describe('plainIssue', () => {
  it('joins the place and the sentence, with no code path', () => {
    const text = plainIssue(issue('tables.0.fields.2.id', 'Invalid input: expected string, received undefined'), spec());
    expect(text).toBe('Table Crews, field Status: This is missing.');
    expect(text).not.toMatch(/tables\.0|\(/);
  });

  it('shows the sentence alone when the path has no place', () => {
    expect(plainIssue(issue('(root)', 'Invalid input: expected object, received string'))).toBe('This has the wrong form.');
    expect(plainIssue(issue('nav.0.pageId', 'Menu item points at a page that is not there.'))).toBe('Menu item points at a page that is not there.');
  });

  it('reads the import refusals of the J5 file', () => {
    expect(plainIssue(issue('specVersion', 'Invalid input: expected 1'))).toBe('File version: This has the wrong form.');
    expect(plainIssue(issue('app.name', 'Too small: expected string to have >=2 characters'))).toBe('App name: This needs at least 2 characters.');
  });

  it('reads the Design and Data problems of a page', () => {
    expect(plainIssue(issue('pages.0.layout.children.1', 'DataTable: this page has no source "x". Use one of: none.'), spec())).toBe(
      'Page Home, a part: This part needs a table. Press Connect on it.',
    );
    expect(plainIssue(issue('menu.start.0.type', 'The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.'))).toBe(
      'Menu bar: The menu bar takes buttons, links, search boxes, quick adds, text and rows.',
    );
  });

  it('never throws on a strange path', () => {
    expect(() => plainIssue(issue('a.b.c.d', 'x'))).not.toThrow();
    expect(() => plainIssue(issue('tables.99999999999999999999.fields.-1', 'x'), spec())).not.toThrow();
  });
});

describe('sentences about what was removed', () => {
  const before = (): AppSpec => structuredClone(baseSpec());
  const after = (): AppSpec => {
    const s = structuredClone(baseSpec());
    s.tables = [];
    return s;
  };
  const sentences = [
    'Table "crews" has no field "status". Use one of: id, created_at, updated_at, name, size, lead_id.',
    'DataTable: table "crews" has no field "status". Use one of: name, size, lead_id, created_at, updated_at.',
    'There is no table "crews". Use one of: people.',
    'Button: there is no page "home". Use one of: none yet.',
    'There is no page "home". Use one of: a, b, c.',
    'Chart: "size" is a text field, but this prop needs integer, real. Use one of: size.',
    'RecordForm: "created_at" is filled in by the app and cannot be edited. Use one of: name.',
    'Chart needs a list source, but "one" is a record source. Use one of: all.',
    'There is no part "chart_1" in the fragment.',
    'Parameter "list" is not used by any binding.',
    'A Feature needs exactly featureId (text) and params (an object of text values, at most 6).',
    'There is no parameter "list".',
    'There is no feature "x". Use one of: a, b.',
  ];

  it('names a removed field, table and page by label, using the saved design', () => {
    expect(plainMessage('Table "crews" has no field "status". Use one of: id, created_at.', after(), before())).toBe('The table Crews has no field Status.');
    expect(plainMessage('There is no table "crews". Use one of: people.', after(), before())).toBe('There is no table Crews.');
    expect(plainMessage('Button: there is no page "home". Use one of: none yet.', spec())).toBe('Button: There is no page Home.');
    expect(plainMessage('There is no table "zzz". Use one of: a.')).toBe('There is no table zzz.');
  });

  it('puts the page title and the part name in the place and says the part once', () => {
    const s = spec();
    s.pages[0].layout.children = [{ id: 'dt', type: 'DataTable', props: {}, children: [] }];
    const text = plainIssue(
      issue('pages.0.layout.children.0.props.columns.2', 'DataTable: table "crews" has no field "status". Use one of: name, size.'),
      s,
      before(),
    );
    expect(text).toBe('Page Home, Table of records: The table Crews has no field Status.');
  });

  it('never shows an id list, created_at, updated_at or a glossary word', () => {
    for (const message of sentences) {
      for (const text of [plainMessage(message), plainMessage(message, after(), before()), plainIssue(issue('pages.0.layout.children.0', message), spec(), before())]) {
        expect(text).not.toMatch(/Use one of|created_at|updated_at|fragment|binding|featureId|params/);
        expect(text).not.toMatch(NEVER_SHOWN);
      }
    }
  });

  it('says the feature library sentences in plain words', () => {
    expect(plainMessage('There is no part "chart_1" in the fragment.')).toBe('A part named chart_1 is not in this feature.');
    expect(plainMessage('Parameter "list" is not used by any binding.')).toBe('The setting list is not used by any part of this feature.');
    expect(plainMessage('A Feature needs exactly featureId (text) and params (an object of text values, at most 6).')).toBe(
      'This feature part is damaged. Remove it and add the feature again.',
    );
  });
});
