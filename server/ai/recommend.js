// First-run model recommendation and Ollama install detection. Pure: no I/O, no env reads
// (callers pass the platform, env and an exists() probe). The picks are chosen so that
// pickAutoModels (registry.js) turns an install into the chat and tools models: the tool model
// is the largest tools-capable model (qwen2.5:7b when present), and the chat model is the
// smallest text model of at least 2.5B parameters below it (llama3.2:3b), else the same model.

const GIB = 1024 ** 3;

const LLAMA_1B = Object.freeze({
  name: 'llama3.2:1b',
  downloadGb: 1.3,
  purpose: 'both',
  reason: 'Small enough to run on a computer with limited memory. Answers are simpler, but it works.',
});
const LLAMA_3B = Object.freeze({
  name: 'llama3.2:3b',
  downloadGb: 2.0,
  purpose: 'both',
  reason: 'A good balance of speed and quality for most computers.',
});
const LLAMA_3B_FAST = Object.freeze({
  name: 'llama3.2:3b',
  downloadGb: 2.0,
  purpose: 'chat',
  reason: 'Fast replies for everyday chat.',
});
const QWEN_7B_OPTIONAL = Object.freeze({
  name: 'qwen2.5:7b',
  downloadGb: 4.7,
  purpose: 'both',
  reason: 'Smarter and better at using your data, but slower on this computer. Optional.',
});
const QWEN_7B_TOOLS = Object.freeze({
  name: 'qwen2.5:7b',
  downloadGb: 4.7,
  purpose: 'tools',
  reason: 'Best at looking things up in your data and making changes you approve.',
});
// License: Qwen2.5 3B may be under a different license than the other Qwen2.5 sizes (reportedly the Qwen Research License, not Apache 2.0). Verify before launch.
const QWEN_3B = Object.freeze({
  name: 'qwen2.5:3b',
  downloadGb: 1.9,
  purpose: 'both',
  reason: 'A small model that is good at using your data. A lighter alternative to qwen2.5:7b.',
});

const QWEN_3B_TOOLS = Object.freeze({
  name: 'qwen2.5:3b',
  downloadGb: 1.9,
  purpose: 'tools',
  reason: 'Free memory is under 8 GB right now, so this is the automatic choice for looking things up in your data. qwen2.5:7b stays the choice on a quiet 16 GB computer.',
});

/** Free memory under this many bytes makes qwen2.5:3b the automatic tools model (D16); the 7B stays when more is free. */
export const LOW_FREE_BYTES = 8 * GIB;

/** Every model the setup flow may download. The pull route accepts nothing else. */
export const PULLABLE_MODELS = new Set([LLAMA_1B.name, LLAMA_3B.name, QWEN_7B_OPTIONAL.name, QWEN_3B.name]);

/**
 * Recommend models for the machine's total memory.
 * @param {number} totalBytes Total RAM in bytes.
 * @param {number} [freeBytes] Free RAM in bytes right now. On a large computer, under 8 GB free picks qwen2.5:3b for tools instead of qwen2.5:7b.
 * @returns {{ tier: 'tiny'|'small'|'medium'|'large', ramGb: number, primary: object[], optional: object[] }}
 */
export function recommendModels(totalBytes, freeBytes) {
  const gib = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes / GIB : 0;
  const ramGb = Math.round(gib * 10) / 10;
  if (gib < 6) return { tier: 'tiny', ramGb, primary: [{ ...LLAMA_1B }], optional: [] };
  if (gib < 10) return { tier: 'small', ramGb, primary: [{ ...LLAMA_3B }], optional: [] };
  if (gib < 14.5) return { tier: 'medium', ramGb, primary: [{ ...LLAMA_3B }], optional: [{ ...QWEN_7B_OPTIONAL }] };
  const busy = Number.isFinite(freeBytes) && freeBytes >= 0 && freeBytes < LOW_FREE_BYTES;
  return { tier: 'large', ramGb, primary: [{ ...(busy ? QWEN_3B_TOOLS : QWEN_7B_TOOLS) }, { ...LLAMA_3B_FAST }], optional: [] };
}

/**
 * Whether the Ollama app or binary exists at a well-known install path.
 * @param {{ platform: string, env?: Record<string, string | undefined>, exists: (path: string) => boolean }} opts
 * @returns {boolean}
 */
export function detectOllamaInstall({ platform, env = {}, exists }) {
  if (typeof exists !== 'function') return false;
  const paths = [];
  if (platform === 'win32') {
    const base = typeof env.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : '';
    if (base) paths.push(`${base.replace(/[\\/]+$/, '')}\\Programs\\Ollama\\ollama.exe`);
  } else if (platform === 'darwin') {
    paths.push('/Applications/Ollama.app', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama');
  } else if (platform === 'linux') {
    paths.push('/usr/local/bin/ollama', '/usr/bin/ollama');
  }
  return paths.some((p) => {
    try {
      return exists(p) === true;
    } catch {
      return false;
    }
  });
}
