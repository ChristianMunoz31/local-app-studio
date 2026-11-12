import { describe, expect, it } from 'vitest';
import { joinPath, matchSpecRoute, normalizeBase, routeFor, routeHasParam, stripBase } from '../routing.js';

const spec = {
  pages: [
    { id: 'home', route: '/' },
    { id: 'crews', route: '/crews' },
    { id: 'crew', route: '/crews/:id' },
    { id: 'new', route: '/crews/new' },
  ],
};

describe('matchSpecRoute', () => {
  it('matches the home page and static pages', () => {
    expect(matchSpecRoute(spec, '/')).toEqual({ pageId: 'home', recordId: null });
    expect(matchSpecRoute(spec, '/crews/')).toEqual({ pageId: 'crews', recordId: null });
  });

  it('takes :id as one decoded segment', () => {
    expect(matchSpecRoute(spec, '/crews/a%20b')).toEqual({ pageId: 'crew', recordId: 'a b' });
    expect(matchSpecRoute(spec, '/crews/a/b')).toBeNull();
    expect(matchSpecRoute(spec, '/crews/%E0%A4%A')).toBeNull();
  });

  it('prefers a route without a parameter', () => {
    expect(matchSpecRoute(spec, '/crews/new')).toEqual({ pageId: 'new', recordId: null });
  });

  it('returns null for an unknown path or a missing spec', () => {
    expect(matchSpecRoute(spec, '/nope')).toBeNull();
    expect(matchSpecRoute(null, '/')).toBeNull();
  });
});

describe('base path', () => {
  it('normalizes, joins and strips', () => {
    expect(normalizeBase('/app/')).toBe('/app');
    expect(normalizeBase(undefined)).toBe('/');
    expect(joinPath('/', '/about')).toBe('/about');
    expect(joinPath('/app', '/')).toBe('/app');
    expect(joinPath('/app/', '/crews/1')).toBe('/app/crews/1');
    expect(stripBase('/app', '/app/crews')).toBe('/crews');
    expect(stripBase('/app', '/app')).toBe('/');
    expect(stripBase('/app', '/other')).toBeNull();
    expect(stripBase('/', '/crews')).toBe('/crews');
  });
});

describe('routeFor', () => {
  it('builds a route, encoding the record id', () => {
    expect(routeFor(spec, 'crews')).toBe('/crews');
    expect(routeFor(spec, 'crew', 'a b/c')).toBe('/crews/a%20b%2Fc');
  });

  it('is null for an unknown page or a record page without an id', () => {
    expect(routeFor(spec, 'missing')).toBeNull();
    expect(routeFor(spec, 'crew')).toBeNull();
  });

  it('flags routes with a parameter', () => {
    expect(routeHasParam('/crews/:id')).toBe(true);
    expect(routeHasParam('/crews')).toBe(false);
  });
});
