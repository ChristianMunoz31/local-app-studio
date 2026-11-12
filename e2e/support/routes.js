// Every routed page in src/App.jsx. A vitest test (server/__tests__/e2eRoutes.test.js) parses App.jsx
// and fails when this list drifts, so a new page cannot ship without an e2e navigation check.
// `pattern` is the `<Route path>` value; `path` is the URL the tests open.
// `heading` is the page's h2 text.
export const ROUTES = Object.freeze([
  { pattern: '/', path: '/', heading: 'Overview' },
  { pattern: '/settings', path: '/settings', heading: 'Settings' },
]);

export const ROUTE_PATTERNS = Object.freeze(ROUTES.map((r) => r.pattern));
