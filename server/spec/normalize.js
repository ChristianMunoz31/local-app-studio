// The server's door to the spec normalizer. The code lives in src/runtime/normalizeSpec.js (pure, no imports), so the
// browser can use it without reaching into server/ (aiBoundary.test.js) and the two can never drift.
export * from '@local-app-studio/runtime/runtime/normalizeSpec.js';
