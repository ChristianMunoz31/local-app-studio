// Shared fixtures for the cloud-off AI settings tests.
export const aiSettings = (build, provider = 'ollama') => ({
  enabled: true,
  provider,
  effectiveProvider: 'ollama',
  ollama: {
    host: 'http://127.0.0.1:11434',
    hostSource: 'default',
    loopback: true,
    running: true,
    version: '0.32.14',
    numCtx: 8192,
    error: null,
  },
  models: {
    chat: { selected: null, effective: 'qwen2.5:3b', source: 'auto' },
    tools: { selected: null, effective: 'qwen2.5:7b', source: 'auto' },
  },
  cloud: {
    build,
    optIn: false,
    keySaved: false,
    baseUrl: null,
    host: null,
    model: null,
    tokenParam: 'max_tokens',
    ready: false,
    consent: { current: false, acceptedAt: null, host: null, version: null },
    consentVersion: 1,
    categories: { items: true, notes: false },
    active: false,
  },
});

export const MODELS = [
  { name: 'qwen2.5:7b', capabilities: ['completion', 'tools'], contextLength: 32768, parameterSize: '7.6B' },
];
