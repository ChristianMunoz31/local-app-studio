// axe (WCAG 2.0/2.1 A and AA) on every route and Settings > AI, light theme.
import { test, useApp } from '../support/fixtures.js';
import { registerThemeTests } from '../support/axe.js';

useApp({ seed: true, ollama: 'fake' });
registerThemeTests(test, 'light');
