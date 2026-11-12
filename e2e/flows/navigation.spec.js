// Every routed page renders its heading with no console errors (seeded data, fake Ollama).
import { test, useApp } from '../support/fixtures.js';
import { ROUTES } from '../support/routes.js';
import { nav } from '../pages/nav.js';

useApp({ seed: true, ollama: 'fake' });

test('every route renders', async ({ page }) => {
  const n = nav(page);
  for (const route of ROUTES) {
    await test.step(route.path, async () => {
      await n.open(route);
    });
  }
});
