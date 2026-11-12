import { describe, expect, it } from 'vitest';
import { APP_NAME_RE, RESERVED_APP_NAMES, isWindowsDeviceName } from '@local-app-studio/runtime/spec/schema';
import { FALLBACK_NAME, NAME_MAX, deriveAppName, uniqueAppName } from '../appName';

describe('deriveAppName', () => {
  it.each([
    ['Crew roster for my painting business.', 'Crew Roster'],
    ['I want an app to keep track of dog walks and vet visits', 'Dog Walks'],
    ['CRM for my plumbing business', 'CRM Plumbing'],
    ['Café orders', 'Cafe Orders'],
    ['', FALLBACK_NAME],
    ['123', FALLBACK_NAME],
    ['an app', FALLBACK_NAME],
  ])('%j gives %j', (input, expected) => {
    expect(deriveAppName(input)).toBe(expected);
  });

  it('prefers the name the person capitalised: a run of 2 to 4 capitalised words (P17-17)', () => {
    const freelancer =
      'A job tracking app for Green Acre Landscaping. Clients (name, phone, address). Jobs with a date, a status (Scheduled, In progress, Done) and the crew assigned.';
    expect(deriveAppName(freelancer)).toBe('Green Acre Landscaping');
    expect(deriveAppName('Job tracker for Green Acre Landscaping', ['green acre landscaping'])).toBe('Green Acre Landscaping 2');
    expect(deriveAppName('Scheduling for Peak Rock Climbing Gym and more')).toBe('Peak Rock Climbing Gym');
  });

  it('does not take a lone capitalised word, a run cut by a comma, one of five words, or a run with an everyday word', () => {
    expect(deriveAppName('Members, Plans, Payments for my gym')).toBe('Members Plans');
    expect(deriveAppName('A tool for Acme')).toBe('Acme');
    expect(deriveAppName('Notes for My Big Fat Greek Wedding Day')).toBe('Notes Big');
    expect(deriveAppName('Crew roster for my painting business.')).toBe('Crew Roster');
  });

  it('keeps the founder name from the first two words that matter ("Membership Climbing")', () => {
    const founder =
      'A membership app for my climbing gym. Members, plans, payments with an amount and a date, a page per member, one number with the total paid, and a chart of payments by month.';
    expect(deriveAppName(founder)).toBe('Membership Climbing');
  });

  it('skips leading digit words and empty first sentences', () => {
    expect(deriveAppName('2024 budget planner')).toBe('Budget Planner');
    expect(deriveAppName('...!\nInvoice tracker')).toBe('Invoice Tracker');
  });

  it('uses only the first sentence', () => {
    expect(deriveAppName('Garden journal. Also tracks seeds.')).toBe('Garden Journal');
  });

  it('adds a number when the name is taken, case-insensitively', () => {
    expect(deriveAppName('Dog walks', ['dog walks'])).toBe('Dog Walks 2');
    expect(deriveAppName('', ['My app', 'My app 2'])).toBe('My app 3');
  });

  it('cuts one very long word to 40 letters', () => {
    const word = 'a'.repeat(60);
    expect(deriveAppName(word)).toBe('A' + 'a'.repeat(39));
  });

  it('keeps the suffixed name within 40 characters', () => {
    const long = 'x'.repeat(60);
    const first = deriveAppName(long);
    const second = deriveAppName(long, [first]);
    expect(second.length).toBeLessThanOrEqual(NAME_MAX);
    expect(second.endsWith(' 2')).toBe(true);
    expect(second.toLowerCase()).not.toBe(first.toLowerCase());
  });

  it('uses the first piece that yields a word ("App: CRM for plumbers")', () => {
    expect(deriveAppName('App: CRM for plumbers')).toBe('CRM Plumbers');
  });

  it(`keeps apostrophes inside a word, so "Don't" becomes "Dont" and never "Don"`, () => {
    expect(deriveAppName("Don't forget the milk")).toBe('Dont Forget');
    expect(deriveAppName('Don’t forget the milk')).toBe('Dont Forget');
  });

  it('falls back for reserved names', () => {
    expect(RESERVED_APP_NAMES.has('local app studio')).toBe(true);
    expect(deriveAppName('Local studio')).not.toBe('');
    expect(RESERVED_APP_NAMES.has(deriveAppName('local app studio').toLowerCase())).toBe(false);
  });

  it.each(['con', 'NUL', 'Aux', 'com1', 'LPT9'])('falls back for the Windows device name %j', (word) => {
    expect(isWindowsDeviceName(word)).toBe(true);
    expect(deriveAppName(word)).toBe(FALLBACK_NAME);
    expect(deriveAppName(`${word}!`)).toBe(FALLBACK_NAME);
  });

  it('always returns a valid name for random input', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const alphabet = 'abcXYZ019 .,!?;:\n-éñ_#';
    for (let i = 0; i < 200; i += 1) {
      const length = next() % 80;
      let text = '';
      for (let j = 0; j < length; j += 1) text += alphabet.charAt(next() % alphabet.length);
      const name = deriveAppName(text);
      expect(APP_NAME_RE.test(name)).toBe(true);
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(NAME_MAX);
      expect(RESERVED_APP_NAMES.has(name.toLowerCase())).toBe(false);
    }
  });

  it('names an app apart from a taken name, whatever the case (P-41)', () => {
    expect(uniqueAppName('Crew Roster', ['crew roster'])).toBe('Crew Roster 2');
    expect(uniqueAppName('Crew Roster', ['Crew Roster', 'Crew Roster 2'])).toBe('Crew Roster 3');
    expect(uniqueAppName('Crew Roster', ['Other'])).toBe('Crew Roster');
    const long = 'A'.repeat(NAME_MAX);
    expect(uniqueAppName(long, [long]).length).toBeLessThanOrEqual(NAME_MAX);
  });
});
