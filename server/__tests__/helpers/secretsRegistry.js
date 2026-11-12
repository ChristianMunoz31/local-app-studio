// The shipped secrets registry holds one key (AI_CLOUD_API_KEY). The tests for the generic key
// machinery (storage, the Test key ping, the network opt-in gate) need a second, testable key, so
// they mock the registry module with this extended copy:
//
//   vi.mock('../secrets/registry.js', async (importOriginal) => (await import('./helpers/secretsRegistry.js')).mockRegistryModule(importOriginal));
//
// EXAMPLE_SERVICE_TOKEN is a made-up service: its Test key ping is gated by the `updates` network
// feature and goes to a .test address that the network guard would block if a test ever let it out.
export const EXAMPLE_TOKEN = 'EXAMPLE_SERVICE_TOKEN';
export const EXAMPLE_TEST_URL = 'https://api.example-service.test/v1/me';

export async function mockRegistryModule(importOriginal) {
  const actual = await importOriginal();
  const example = Object.freeze({
    name: EXAMPLE_TOKEN,
    label: 'Example service',
    provider: 'example',
    description: 'A made-up service used by the tests',
    pattern: /^[A-Za-z0-9_-]{20,128}$/,
    maxLength: 128,
    networkFeature: 'updates',
    test: Object.freeze({ url: EXAMPLE_TEST_URL, headers: actual.bearer }),
  });
  const defs = Object.freeze([...actual.SECRET_DEFS, example]);
  const byName = new Map(defs.map((d) => [d.name, d]));
  const getSecretDef = (name) => (typeof name === 'string' ? byName.get(name) : undefined);
  const validateSecretValue = (name, raw) => {
    const def = getSecretDef(name);
    if (!def || typeof raw !== 'string') return { ok: false };
    const value = raw.trim();
    // eslint-disable-next-line no-control-regex
    if (!value || value.length > def.maxLength || /[\s\x00-\x1f\x7f]/.test(value)) return { ok: false };
    if (!def.pattern.test(value)) return { ok: false };
    return { ok: true, value };
  };
  return {
    ...actual,
    SECRET_DEFS: defs,
    SECRET_NAMES: Object.freeze(defs.map((d) => d.name)),
    getSecretDef,
    validateSecretValue,
  };
}
