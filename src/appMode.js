// The UI's app mode (ADR-001). Vite defines __APP_MODE__ at build time ('studio' or 'runtime', see
// scripts/desktop/modeBuild.js). Under Vitest nothing is defined, so the mode is 'studio' unless APP_MODE=runtime.
/* global __APP_MODE__ */
const fromEnv = () => {
  const raw = globalThis.process?.env?.APP_MODE;
  return raw === 'runtime' ? 'runtime' : 'studio';
};

/** @type {'studio' | 'runtime'} */
export const APP_MODE = typeof __APP_MODE__ === 'string' ? __APP_MODE__ : fromEnv();
