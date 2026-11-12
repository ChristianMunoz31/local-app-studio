// The sidecar bundle with and without the cloud provider (what scripts/desktop/buildSidecar.js builds).
// Real esbuild on server/entry.js, minified like the shipped sidecar, with the cloudProviderPlugin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudProviderPlugin } from '../../scripts/desktop/cloudBuild.js';
import { resolveProDir } from '../../scripts/lib/proDir.js';
import { proSeamEsbuildPlugin } from '../../scripts/lib/proSeam.js';
import { BUNDLE_BANNER, bundleDefine, channelBanner } from '../../scripts/desktop/workerBundle.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import { CLOUD_PROVIDER_MARKER, CLOUD_WIRE_TEXT, checkServerArtifact } from '../../scripts/checks/cloudMarker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The real provider and its transport are pro twins: a pro run bundles them through the pro seam plugin, registered after the cloud one like buildSidecar.js.
const PRO = resolveProDir(process.env);
const LLM_TWIN = path.join(ROOT, 'pro', 'server', 'ai', 'llmClient.js');
let dir;
const results = {};

const bundle = async (cloudAi, extra = {}) => {
  const outfile = extra.outfile ?? path.join(dir, `server-${cloudAi}.cjs`);
  const result = await build({
    entryPoints: [path.join(ROOT, 'server', 'entry.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    minify: true,
    metafile: true,
    legalComments: 'none',
    logLevel: 'silent',
    define: { ...bundleDefine('0.0.0', { channel: 'stable', buildDate: '2026-01-01T00:00:00Z', cloudAi }), __APP_BACKUP_WORKER_SRC__: '""' },
    banner: { js: channelBanner('stable') + BUNDLE_BANNER },
    plugins: [cloudProviderPlugin(cloudAi), proSeamEsbuildPlugin(PRO)],
    ...extra,
    outfile,
  });
  return { text: fs.readFileSync(outfile, 'utf8'), inputs: Object.keys(result.metafile.inputs) };
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-bundle-'));
  results.off = await bundle('off');
  results.on = await bundle('on');
}, 180_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('cloud off', () => {
  it('uses the disabled stub and pulls in neither the real transport nor its client', () => {
    expect(results.off.inputs).toContain('server/ai/providers/openaiCompat.disabled.js');
    expect(results.off.inputs).not.toContain('server/ai/providers/openaiCompat.js');
    expect(results.off.inputs).not.toContain('pro/server/ai/providers/openaiCompat.js');
    expect(results.off.inputs).not.toContain('pro/server/ai/llmClient.js');
  });

  it('carries no provider marker and no wire path', () => {
    expect(results.off.text).not.toContain(CLOUD_PROVIDER_MARKER);
    expect(results.off.text).not.toContain(CLOUD_WIRE_TEXT);
    expect(checkServerArtifact(results.off.text, 'absent')).toEqual([]);
    expect(checkServerArtifact(results.off.text, 'present')).toHaveLength(1);
  });

  it.skipIf(!fs.existsSync(LLM_TWIN))('fails the build when something else pulls the real transport in (its pro twin, in a pro or a public run)', async () => {
    const stray = path.join(dir, 'stray.js');
    const client = LLM_TWIN.replace(/\\/g, '/');
    fs.writeFileSync(stray, `import ${JSON.stringify(client)};\n`);
    await expect(bundle('off', { entryPoints: [stray], outfile: path.join(dir, 'stray.cjs') })).rejects.toThrow(/must not be in a cloud-off build/);
  });
});

describe('cloud on', () => {
  it.skipIf(PUBLIC_BUILD)('keeps the real transport and its marker through --minify (the transport is pro, which is not in a public build)', () => {
    expect(results.on.inputs).toContain('pro/server/ai/providers/openaiCompat.js');
    expect(results.on.inputs).toContain('pro/server/ai/llmClient.js');
    expect(results.on.inputs).not.toContain('server/ai/providers/openaiCompat.disabled.js');
    expect(results.on.text).toContain(CLOUD_PROVIDER_MARKER);
    expect(checkServerArtifact(results.on.text, 'present')).toEqual([]);
    expect(checkServerArtifact(results.on.text, 'absent').length).toBeGreaterThan(0);
  });
});
