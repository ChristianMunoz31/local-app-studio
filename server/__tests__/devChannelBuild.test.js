// Build side of the Local App Studio Dev channel: version numbers, sidecar defines and banner, the bundle-level
// license rule (only a dev bundle allows store test purchases), the channel marker check, the stable-only desktop:build
// guard, the dev installer naming and the DEV icon badge.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { checkBuildInfo, checkBundleText, main as markerMain } from '../../scripts/checks/channelMarker.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import { assertStableBuildEnv, STABLE_ONLY_MESSAGE, stableChildEnv } from '../../scripts/desktop/build.js';
import { buildDevConfig, collectArtifacts, devArtifactName, isValidDevArtifactName, mergeConfig } from '../../scripts/desktop/buildDev.js';
import { devVersions, nextVersion, NO_GIT_MESSAGE, readNextVersion, resolveDevVersions } from '../../scripts/desktop/devVersion.js';
import { readSquareViewBox, withDevBadge } from '../../scripts/desktop/icons.js';
import {
  BUNDLE_BANNER,
  buildBackupWorkerSource,
  bundleDefine,
  channelBanner,
  CHANNEL_MARKER_PREFIX,
  readBundledBuildDate,
  resolveChannelBuild,
} from '../../scripts/desktop/workerBundle.js';
import { DEV_VERSION_RE } from '../channel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = 'abc1234'.padEnd(40, '0');
const DISPLAY = '0.2.0-dev.20261005.abc1234';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-devbuild-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const collect = () => {
  const out = { logs: [], errors: [] };
  out.io = { log: (m) => out.logs.push(m), error: (m) => out.errors.push(m) };
  return out;
};

describe('nextVersion and devVersions', () => {
  it('bumps the minor like release-please does for a feature', () => {
    expect(nextVersion({ current: '0.1.0', bumpMinorPreMajor: true })).toBe('0.2.0');
    expect(nextVersion({ current: '1.4.2', bumpMinorPreMajor: true })).toBe('1.5.0');
    expect(nextVersion({ current: '1.4.2', bumpMinorPreMajor: false })).toBe('1.5.0');
    expect(nextVersion({ current: '0.1.0', bumpMinorPreMajor: false })).toBe('0.2.0');
  });

  it('strips a pre-release or build suffix first', () => {
    expect(nextVersion({ current: '0.3.1-dev.20260101.abc1234', bumpMinorPreMajor: true })).toBe('0.4.0');
    expect(nextVersion({ current: '2.0.0-rc.1+5', bumpMinorPreMajor: true })).toBe('2.1.0');
  });

  it('rejects a version it cannot read', () => {
    expect(() => nextVersion({ current: 'nope', bumpMinorPreMajor: true })).toThrow(/Cannot read a version/);
  });

  it('derives the documented example: 2026-10-05, abc1234, manifest 0.1.0', () => {
    const v = devVersions({ next: '0.2.0', buildDateMs: Date.UTC(2026, 9, 5, 12), sha: SHA });
    expect(v).toEqual({
      display: DISPLAY,
      bundle: '0.2.0-dev.20261005+1008',
      buildNumber: 1008,
      dateStamp: '20261005',
      shortSha: 'abc1234',
      tag: 'dev-20261005-abc1234',
    });
    expect(DEV_VERSION_RE.test(v.display)).toBe(true);
  });

  it('keeps exactly 7 characters of an all-digit sha and lowercases it', () => {
    const digits = devVersions({ next: '0.2.0', buildDateMs: Date.UTC(2026, 9, 5), sha: '0123456789012345678901234567890123456789' });
    expect(digits.shortSha).toBe('0123456');
    expect(digits.display).toBe('0.2.0-dev.20261005.0123456');
    expect(devVersions({ next: '0.2.0', buildDateMs: Date.UTC(2026, 9, 5), sha: 'ABCDEF1'.padEnd(40, 'F') }).shortSha).toBe('abcdef1');
  });

  it('rejects a sha that is not 7 hex characters and an out-of-range build number', () => {
    expect(() => devVersions({ next: '0.2.0', buildDateMs: Date.UTC(2026, 9, 5), sha: 'zzzzzzz' })).toThrow(NO_GIT_MESSAGE);
    expect(() => devVersions({ next: '0.2.0', buildDateMs: Date.UTC(2023, 5, 1), sha: SHA })).toThrow(/out of range/);
    expect(() => devVersions({ next: '0.2.0', buildDateMs: Date.UTC(2024, 0, 1) + 65536 * 86_400_000, sha: SHA })).toThrow(/out of range/);
  });

  it('readNextVersion uses the manifest and the config flag, else package.json', () => {
    expect(readNextVersion(ROOT)).toMatch(/^\d+\.\d+\.0$/);
    const root = path.join(tmp, 'repo');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.1.4' }));
    expect(readNextVersion(root)).toBe('3.2.0');
    fs.writeFileSync(path.join(root, '.release-please-manifest.json'), JSON.stringify({ '.': '0.7.2' }));
    fs.writeFileSync(path.join(root, 'release-please-config.json'), JSON.stringify({ packages: { '.': { 'bump-minor-pre-major': true } } }));
    expect(readNextVersion(root)).toBe('0.8.0');
    fs.rmSync(path.join(root, 'package.json'));
    fs.rmSync(path.join(root, '.release-please-manifest.json'));
    expect(() => readNextVersion(root)).toThrow(/No version found/);
  });

  it('resolveDevVersions reads the build date like the license build date and refuses without git', () => {
    const env = { APP_BUILD_DATE: '2026-10-05T12:00:00Z' };
    const v = resolveDevVersions({ root: ROOT, env, git: () => SHA });
    expect(v.display).toMatch(/^\d+\.\d+\.0-dev\.20261005\.abc1234$/);
    expect(v.buildNumber).toBe(1008);
    expect(() => resolveDevVersions({ root: ROOT, env, git: () => null })).toThrow(NO_GIT_MESSAGE);
    expect(() => resolveDevVersions({ root: ROOT, env, git: () => 'abc1234' })).toThrow(NO_GIT_MESSAGE);
    expect(() => resolveDevVersions({ root: ROOT, env, git: () => '' })).toThrow(NO_GIT_MESSAGE);
  });
});

describe('bundleDefine and channelBanner', () => {
  it('a stable bundle bakes the channel', () => {
    const def = bundleDefine('0.1.0');
    expect(def.__APP_CHANNEL__).toBe('"stable"');
    expect(def.__APP_RELEASE_BUILD__).toBe('true');
    expect(def.__APP_APP_VERSION__).toBe('"0.1.0"');
    expect(bundleDefine('0.1.0', { channel: 'stable' })).toEqual(def);
  });

  it('an unknown channel throws', () => {
    expect(() => bundleDefine('0.1.0', { channel: 'beta' })).toThrow(/Unknown channel/);
    expect(() => channelBanner('')).toThrow(/Unknown channel/);
  });

  it('bakes the cloud AI mode, on by default, and rejects anything else', () => {
    expect(bundleDefine('0.1.0').__APP_CLOUD_AI__).toBe('"on"');
    expect(bundleDefine('0.1.0', { cloudAi: 'off' }).__APP_CLOUD_AI__).toBe('"off"');
    expect(() => bundleDefine('0.1.0', { cloudAi: 'maybe' })).toThrow(/must be one of on, off/);
  });

  it('a dev bundle bakes the dev channel and keeps the release flag', () => {
    const def = bundleDefine(DISPLAY, { channel: 'dev' });
    expect(def.__APP_CHANNEL__).toBe('"dev"');
    expect(def.__APP_RELEASE_BUILD__).toBe('true');
    expect(def.__APP_APP_VERSION__).toBe(JSON.stringify(DISPLAY));
  });

  it('bakes the build date define when given (M3), and the sidecar bundler always passes it', () => {
    const iso = '2026-10-05T12:00:00Z';
    expect(bundleDefine('0.1.0', { buildDate: iso }).__APP_BUILD_DATE__).toBe(JSON.stringify(iso));
    expect(bundleDefine(DISPLAY, { channel: 'dev', buildDate: iso }).__APP_BUILD_DATE__).toBe(JSON.stringify(iso));
    const sidecar = fs.readFileSync(path.join(ROOT, 'scripts', 'desktop', 'buildSidecar.js'), 'utf8');
    expect(sidecar).toMatch(/readBundledBuildDate\(/);
    expect(sidecar).toMatch(/bundleDefine\(channelBuild\.version, \{ channel: channelBuild\.channel, buildDate, cloudAi, appMode, appSpecJson \}\)/);
  });

  it('readBundledBuildDate returns the build-info writer date and fails the bundle when it is missing or invalid', () => {
    const iso = '2026-10-05T12:00:00Z';
    fs.writeFileSync(
      path.join(tmp, 'local-app-studio-build-info.json'),
      JSON.stringify({ formatVersion: 1, buildDate: iso, source: 'git', version: '0.1.0', channel: 'stable' }),
    );
    expect(readBundledBuildDate(tmp)).toBe(iso);
    fs.writeFileSync(path.join(tmp, 'local-app-studio-build-info.json'), '{"formatVersion":1,"buildDate":"nope"}');
    expect(() => readBundledBuildDate(tmp)).toThrow(/missing or invalid/);
    fs.rmSync(path.join(tmp, 'local-app-studio-build-info.json'));
    expect(() => readBundledBuildDate(tmp)).toThrow(/missing or invalid/);
  });

  it('the banner is the marker line the check reads', () => {
    expect(channelBanner('stable')).toBe('/*! APP_CHANNEL=stable */\n');
    expect(channelBanner('dev')).toBe('/*! APP_CHANNEL=dev */\n');
    expect(channelBanner('dev').startsWith(CHANNEL_MARKER_PREFIX)).toBe(true);
    expect(BUNDLE_BANNER.startsWith('/*!')).toBe(false);
  });

  it.each(['stable', 'dev'])('the real backup worker bundle starts with the %s marker', async (channel) => {
    const src = await buildBackupWorkerSource({ channel, version: channel === 'dev' ? DISPLAY : '0.1.0' });
    expect(checkBundleText(src, channel)).toEqual([]);
    expect(checkBundleText(src, channel === 'dev' ? 'stable' : 'dev')).not.toEqual([]);
  }, 60_000);
});

describe('resolveChannelBuild (buildSidecar flags)', () => {
  it('defaults to stable with the package version', () => {
    expect(resolveChannelBuild({ channel: null, displayVersion: null, packageVersion: '0.1.0' })).toEqual({
      channel: 'stable',
      version: '0.1.0',
    });
    expect(resolveChannelBuild({ channel: '  ', displayVersion: '', packageVersion: '0.1.0' }).channel).toBe('stable');
  });

  it('refuses a display version for stable and an unknown channel', () => {
    expect(() => resolveChannelBuild({ channel: 'stable', displayVersion: DISPLAY, packageVersion: '0.1.0' })).toThrow(/only for a dev build/);
    expect(() => resolveChannelBuild({ channel: 'beta', displayVersion: null, packageVersion: '0.1.0' })).toThrow(/--channel must be one of/);
  });

  it('dev needs a valid display version', () => {
    expect(() => resolveChannelBuild({ channel: 'dev', displayVersion: null, packageVersion: '0.1.0' })).toThrow(/needs --display-version/);
    expect(() => resolveChannelBuild({ channel: 'dev', displayVersion: '0.2.0', packageVersion: '0.1.0' })).toThrow(/needs --display-version/);
    expect(resolveChannelBuild({ channel: 'dev', displayVersion: DISPLAY, packageVersion: '0.1.0' })).toEqual({
      channel: 'dev',
      version: DISPLAY,
    });
  });

  it('the real flags fail before building anything', () => {
    const run = (args, env = {}) =>
      spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'desktop', 'buildSidecar.js'), '--bundle-only', ...args], {
        cwd: ROOT,
        env: { ...process.env, APP_CHANNEL: '', APP_DISPLAY_VERSION: '', ...env },
        encoding: 'utf8',
      });
    const noVersion = run(['--channel', 'dev']);
    expect(noVersion.status).toBe(1);
    expect(noVersion.stderr).toMatch(/needs --display-version/);
    const stableVersion = run(['--display-version', DISPLAY]);
    expect(stableVersion.status).toBe(1);
    expect(stableVersion.stderr).toMatch(/only for a dev build/);
  }, 60_000);
});

// Bundles the real channelSeam module with each define, loads the result and asks it about test
// purchases. This is the guarantee the release relies on: a stable bundle cannot be switched to dev.
describe('store test purchases in a bundled sidecar', () => {
  const require = createRequire(import.meta.url);

  async function bundleSeam(name, define) {
    const file = path.join(tmp, `${name}.cjs`);
    await build({
      entryPoints: [path.join(ROOT, 'server', 'license', 'channelSeam.js')],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      logLevel: 'silent',
      define,
      banner: { js: channelBanner(define.__APP_CHANNEL__ === '"dev"' ? 'dev' : 'stable') + BUNDLE_BANNER },
    });
    return { text: fs.readFileSync(file, 'utf8'), seam: require(file) };
  }

  it('a stable bundle refuses test purchases, whatever the environment says', async () => {
    const { text, seam } = await bundleSeam('stable', bundleDefine('0.1.0'));
    expect(checkBundleText(text, 'stable')).toEqual([]);
    const env = { APP_LICENSE_STORE_TEST: '1', APP_CHANNEL: 'dev' };
    expect(seam.allowStoreTestPurchases(env)).toBe(false);
    expect(seam.allowStoreTestPurchases({ ...env, APP_DESKTOP: '1' })).toBe(false);
    expect(seam.allowStoreTestPurchases({})).toBe(false);
  });

  it('a dev bundle accepts test purchases, also in desktop mode and without the env switch', async () => {
    const { text, seam } = await bundleSeam('dev', bundleDefine(DISPLAY, { channel: 'dev' }));
    expect(checkBundleText(text, 'dev')).toEqual([]);
    expect(seam.allowStoreTestPurchases({})).toBe(true);
    expect(seam.allowStoreTestPurchases({ APP_DESKTOP: '1' })).toBe(true);
  });
});

describe('bundled build date', () => {
  const require = createRequire(import.meta.url);

  it('a bundle with the define prefers it over an edited dist file', async () => {
    const iso = '2026-10-05T12:00:00Z';
    const file = path.join(tmp, 'buildInfo.cjs');
    await build({
      entryPoints: [path.join(ROOT, 'server', 'license', 'buildInfo.js')],
      outfile: file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      logLevel: 'silent',
      define: bundleDefine('0.1.0', { buildDate: iso }),
      banner: { js: BUNDLE_BANNER },
    });
    fs.writeFileSync(
      path.join(tmp, 'local-app-studio-build-info.json'),
      JSON.stringify({ formatVersion: 1, buildDate: '2000-01-01T00:00:00Z', source: 'git', version: '0.1.0' }),
    );
    const info = require(file).loadBuildInfo({ distDir: tmp });
    expect(info.source).toBe('bundled');
    expect(info.buildDateIso).toBe(iso);
  });
});

describe('channelMarker', () => {
  it('checkBundleText wants the marker on the first line', () => {
    expect(checkBundleText('/*! APP_CHANNEL=stable */\nvar a=1', 'stable')).toEqual([]);
    expect(checkBundleText('/*! APP_CHANNEL=dev */\r\nvar a=1', 'dev')).toEqual([]);
    expect(checkBundleText('var a=1\n/*! APP_CHANNEL=stable */', 'stable')).toHaveLength(1);
    expect(checkBundleText('/*! APP_CHANNEL=dev */\nvar a=1', 'stable').length).toBeGreaterThan(0);
    expect(checkBundleText('', 'dev')).toHaveLength(1);
  });

  it('a stable bundle must not mention the dev channel anywhere', () => {
    const text = '/*! APP_CHANNEL=stable */\nconsole.log("APP_CHANNEL=dev")';
    expect(checkBundleText(text, 'stable')).toEqual([expect.stringMatching(/must not contain/)]);
    expect(checkBundleText('/*! APP_CHANNEL=dev */\nconsole.log("APP_CHANNEL=dev")', 'dev')).toEqual([]);
  });

  it('checkBuildInfo treats a missing channel as stable and checks the dev version', () => {
    expect(checkBuildInfo({ version: '0.1.0' }, 'stable')).toEqual([]);
    expect(checkBuildInfo({ channel: 'stable', version: '0.1.0' }, 'stable')).toEqual([]);
    expect(checkBuildInfo({ channel: 'dev', version: DISPLAY }, 'dev')).toEqual([]);
    expect(checkBuildInfo({ channel: 'dev', version: DISPLAY }, 'stable')).toHaveLength(1);
    expect(checkBuildInfo({ version: '0.1.0' }, 'dev').length).toBeGreaterThan(0);
    expect(checkBuildInfo({ channel: 'dev', version: '0.2.0' }, 'dev')).toHaveLength(1);
    expect(checkBuildInfo(null, 'stable')).toHaveLength(1);
    expect(checkBuildInfo([], 'stable')).toHaveLength(1);
  });

  it('the CLI returns 0 when everything matches and 1 on any problem', () => {
    const good = path.join(tmp, 'good.cjs');
    const bad = path.join(tmp, 'bad.cjs');
    fs.writeFileSync(good, '/*! APP_CHANNEL=dev */\nx');
    fs.writeFileSync(bad, 'x');
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'local-app-studio-build-info.json'), JSON.stringify({ formatVersion: 1, version: DISPLAY, channel: 'dev' }));

    const ok = collect();
    expect(markerMain(['--expect', 'dev', '--bundle', good, '--dist-dir', dist], ok.io)).toBe(0);
    expect(ok.logs).toHaveLength(2);

    const failed = collect();
    expect(markerMain(['--expect', 'dev', '--bundle', good, '--bundle', bad], failed.io)).toBe(1);
    expect(failed.errors.join(' ')).toContain('bad.cjs');
    expect(markerMain(['--expect', 'stable', '--dist-dir', dist], collect().io)).toBe(1);
    expect(markerMain(['--expect', 'dev', '--bundle', path.join(tmp, 'missing.cjs')], collect().io)).toBe(1);
    expect(markerMain(['--expect', 'dev', '--dist-dir', path.join(tmp, 'nothing')], collect().io)).toBe(1);
  });

  it('the CLI refuses a bad expectation, no target, an unknown flag and a flag without a value', () => {
    expect(markerMain(['--expect', 'beta', '--bundle', 'x'], collect().io)).toBe(1);
    expect(markerMain(['--bundle', 'x'], collect().io)).toBe(1);
    const none = collect();
    expect(markerMain(['--expect', 'dev'], none.io)).toBe(1);
    expect(none.errors.join(' ')).toMatch(/at least one/);
    expect(markerMain(['--expect', 'dev', '--what'], collect().io)).toBe(1);
    expect(markerMain(['--expect'], collect().io)).toBe(1);
  });

  it('the real process exits 1 without a target', () => {
    const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'checks', 'channelMarker.js'), '--expect', 'dev'], { encoding: 'utf8' });
    expect(res.status).toBe(1);
  });
});

describe.skipIf(PUBLIC_BUILD)('desktop:build is stable only (the installer build script is pro, which is not in a public build)', () => {
  it('accepts an unset or stable channel without a display version', () => {
    expect(() => assertStableBuildEnv({})).not.toThrow();
    expect(() => assertStableBuildEnv({ APP_CHANNEL: '' })).not.toThrow();
    expect(() => assertStableBuildEnv({ APP_CHANNEL: 'stable', APP_DISPLAY_VERSION: '' })).not.toThrow();
  });

  it('refuses the dev channel, any other channel and any display version', () => {
    expect(() => assertStableBuildEnv({ APP_CHANNEL: 'dev' })).toThrow(STABLE_ONLY_MESSAGE);
    expect(() => assertStableBuildEnv({ APP_CHANNEL: 'beta' })).toThrow(STABLE_ONLY_MESSAGE);
    expect(() => assertStableBuildEnv({ APP_DISPLAY_VERSION: DISPLAY })).toThrow(STABLE_ONLY_MESSAGE);
    expect(STABLE_ONLY_MESSAGE).toBe('desktop:build makes stable builds only. For a Local App Studio Dev build run npm run desktop:build:dev.');
  });

  it('children run with an explicit stable channel and no display version', () => {
    const env = stableChildEnv({ PATH: 'p', APP_CHANNEL: '', APP_DISPLAY_VERSION: '' });
    expect(env.APP_CHANNEL).toBe('stable');
    expect(env).not.toHaveProperty('APP_DISPLAY_VERSION');
    expect(env.PATH).toBe('p');
  });

  it('children never inherit TAURI_CONFIG (it would bypass the --config check)', () => {
    expect(stableChildEnv({ PATH: 'p', TAURI_CONFIG: '{"identifier":"x"}' })).not.toHaveProperty('TAURI_CONFIG');
  });

  it('the real script refuses a dev environment before building anything', () => {
    const res = spawnSync(process.execPath, [path.join(ROOT, 'pro', 'scripts', 'desktop', 'build.js')], {
      cwd: ROOT,
      env: { ...process.env, APP_CHANNEL: 'dev' },
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(STABLE_ONLY_MESSAGE);
  }, 60_000);
});

describe('dev installer config and names', () => {
  const versions = { bundle: '0.2.0-dev.20261005+1008', display: DISPLAY, buildNumber: 1008 };

  it('mergeConfig merges objects and replaces everything else', () => {
    expect(mergeConfig({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2], e: 3 } })).toEqual({ a: { b: 1, c: [2], e: 3 }, d: 1 });
  });

  it('the generated config keeps the committed overlay and adds the versions', () => {
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.dev.conf.json'), 'utf8'));
    const merged = buildDevConfig(committed, versions);
    expect(merged.version).toBe('0.2.0-dev.20261005+1008');
    expect(merged.identifier).toBe('com.neuralfoundry.localappstudio.dev');
    expect(merged.productName).toBe('Local App Studio Dev');
    expect(merged.mainBinaryName).toBe('AppDev');
    expect(merged.bundle.macOS).toEqual({ bundleVersion: '1008' });
    expect(merged.bundle.windows.nsis.installerHooks).toBe('installer/hooks.dev.nsh');
    expect(merged.bundle.icon.every((f) => f.startsWith('icons/dev/'))).toBe(true);
  });

  it('the committed overlay points at files that exist', () => {
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.dev.conf.json'), 'utf8'));
    for (const icon of committed.bundle.icon) expect(fs.existsSync(path.join(ROOT, 'src-tauri', icon)), icon).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'src-tauri', committed.bundle.windows.nsis.installerHooks))).toBe(true);
  });

  it('renames the bundle for publishing', () => {
    expect(devArtifactName('Local App Studio Dev_0.2.0-dev.20261005+1008_arm64-setup.exe', versions)).toBe(`Local-App-Studio-Dev_${DISPLAY}_arm64-setup.exe`);
    expect(isValidDevArtifactName(`Local-App-Studio-Dev_${DISPLAY}_arm64-setup.exe`, DISPLAY)).toBe(true);
    expect(isValidDevArtifactName('Local App Studio_0.1.0_arm64-setup.exe', DISPLAY)).toBe(false);
    expect(isValidDevArtifactName(`Local App Studio_${DISPLAY}.exe`, DISPLAY)).toBe(true);
    expect(isValidDevArtifactName('Local App Studio_0.2.0.exe', '0.2.0')).toBe(false);
  });

  it('collects only this build, with dev names and a checksum file', () => {
    const target = path.join(tmp, 'target');
    const nsis = path.join(target, 'release', 'bundle', 'nsis');
    fs.mkdirSync(nsis, { recursive: true });
    fs.writeFileSync(path.join(nsis, 'Local App Studio Dev_0.2.0-dev.20261005+1008_arm64-setup.exe'), 'new');
    fs.writeFileSync(path.join(nsis, 'Local App Studio Dev_0.2.0-dev.20261004+1007_arm64-setup.exe'), 'old');
    fs.writeFileSync(path.join(nsis, 'Local App Studio_0.1.0_arm64-setup.exe'), 'stable');
    const out = path.join(tmp, 'out');
    const names = collectArtifacts({ outDir: out, platform: 'windows', versions, targetDir: target, log: () => {} });
    expect(names).toEqual([`Local-App-Studio-Dev_${DISPLAY}_arm64-setup.exe`]);
    expect(fs.readdirSync(out).sort()).toEqual(['SHA256SUMS-dev-windows.txt', `Local-App-Studio-Dev_${DISPLAY}_arm64-setup.exe`].sort());
    expect(fs.readFileSync(path.join(out, 'SHA256SUMS-dev-windows.txt'), 'utf8')).toMatch(
      new RegExp(`^[0-9a-f]{64} {2}Local-App-Studio-Dev_${DISPLAY.replaceAll('.', '\\.')}_arm64-setup\\.exe\\n$`),
    );
  });

  it('fails when nothing matches, and for an unknown platform', () => {
    const target = path.join(tmp, 'target');
    fs.mkdirSync(path.join(target, 'release', 'bundle', 'nsis'), { recursive: true });
    expect(() => collectArtifacts({ outDir: path.join(tmp, 'o'), platform: 'windows', versions, targetDir: target, log: () => {} })).toThrow(/No Local App Studio Dev installers/);
    expect(() => collectArtifacts({ outDir: path.join(tmp, 'o'), platform: 'plan9', versions, targetDir: target, log: () => {} })).toThrow(/--platform/);
  });
});

describe('DEV icon badge', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src-tauri', 'icons', 'source.svg'), 'utf8');

  it('requires a square viewBox', () => {
    expect(readSquareViewBox(source)).toEqual({ minX: 0, minY: 0, size: 32 });
    expect(() => readSquareViewBox('<svg viewBox="0 0 32 16"></svg>')).toThrow(/square/);
    expect(() => readSquareViewBox('<svg width="32"></svg>')).toThrow(/viewBox/);
  });

  it('adds a text-free badge before the closing tag and scales it to the viewBox', () => {
    const badge = withDevBadge(source);
    expect(badge.endsWith('</svg>') || badge.trimEnd().endsWith('</svg>')).toBe(true);
    expect(badge).toContain('fill="#f59e0b"');
    expect(badge).not.toContain('<text');
    expect(badge.indexOf('<g transform')).toBeLessThan(badge.lastIndexOf('</svg>'));
    expect(withDevBadge('<svg viewBox="10 20 64 64"></svg>')).toContain('translate(10 20) scale(2)');
  });

  it('the committed dev source is the generated one and the dev icons exist', () => {
    const dev = fs.readFileSync(path.join(ROOT, 'src-tauri', 'icons', 'dev', 'source.svg'), 'utf8');
    expect(dev).toBe(withDevBadge(source));
    for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico', 'icon.png']) {
      expect(fs.existsSync(path.join(ROOT, 'src-tauri', 'icons', 'dev', file)), file).toBe(true);
    }
  });
});
