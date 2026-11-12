// Hygiene after the Ed25519 signer was retired (docs/LICENSING.md): scripts/checks/noPrivateKeys.js
// still catches PEM private keys, the check chain works without check:devkeys, the gitleaks config has no
// Ed25519 rules, and no code or config still refers to the removed tooling. Positive fixtures are built at
// runtime from a generated key, so this file never holds key material. It is excluded from the check by exact path.
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCLUDED_FILES, PATTERNS, isCheckedFile, scanText } from '../../../scripts/checks/noPrivateKeys.js';
import { PRIVATE_WORKFLOWS } from '../helpers/workflowSet.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));
const kinds = (text) => scanText(text).map((f) => f.kind);

const pair = generateKeyPairSync('ed25519');
const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const der = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
const jwk = pair.privateKey.export({ format: 'jwk' });

describe('noPrivateKeys still catches PEM', () => {
  it('flags a PEM private key (PKCS8, OpenSSH, EC, RSA and encrypted headers) with its line', () => {
    expect(kinds(`notes\n${pem}`)).toContain('pem-private-key');
    expect(scanText(`x\ny\n${pem}`)[0].line).toBe(3);
    const dash = '-----';
    for (const label of ['OPENSSH PRIVATE KEY', 'EC PRIVATE KEY', 'RSA PRIVATE KEY', 'ENCRYPTED PRIVATE KEY']) {
      expect(kinds(`${dash}BEGIN ${label}${dash}\nabc`)).toContain('pem-private-key');
    }
  });

  it('has only the PEM pattern: the Ed25519 DER and JWK patterns are gone', () => {
    expect(PATTERNS.map((p) => p.kind)).toEqual(['pem-private-key']);
    expect(kinds(`key = "${der.toString('base64')}"`)).toEqual([]);
    expect(kinds(JSON.stringify(jwk))).toEqual([]);
  });

  it('never prints the matched text', () => {
    for (const finding of scanText(pem)) expect(Object.keys(finding).sort()).toEqual(['kind', 'line']);
  });

  it('does not flag public keys', () => {
    expect(scanText(pair.publicKey.export({ type: 'spki', format: 'pem' }))).toEqual([]);
    expect(scanText(pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))).toEqual([]);
  });

  it('skips only its own file and its test, plus binary files', () => {
    expect([...EXCLUDED_FILES].sort()).toEqual(['scripts/checks/noPrivateKeys.js', 'server/__tests__/license/noPrivateKeys.test.js']);
    expect(isCheckedFile('scripts/checks/noPrivateKeys.js')).toBe(false);
    expect(isCheckedFile('server/__tests__/license/noPrivateKeys.test.js')).toBe(false);
    expect(isCheckedFile('docs/LICENSING.md')).toBe(true);
    expect(isCheckedFile('public/logo.png')).toBe(false);
  });
});

describe('the check chain without the dev key tooling', () => {
  const scripts = JSON.parse(read('package.json')).scripts;

  it('npm run check runs em dash, personal data, private keys and workflow checks, no dev key tooling', () => {
    expect(scripts.check).toBe(
      'npm run check:em-dash && npm run check:personal && npm run check:keys && npm run check:workflows && npm run check:pro-marker -- --require-present --source',
    );
    expect(scripts['check:devkeys']).toBeUndefined();
    for (const name of ['check:em-dash', 'check:personal', 'check:keys', 'check:workflows', 'check:bundle']) expect(scripts[name]).toBeTypeOf('string');
  });

  it.skipIf(!PRIVATE_WORKFLOWS)('keeps the build-date postbuild hook and its release checks (pins release.yml, which is not in a public export)', () => {
    expect(scripts.postbuild).toContain('writeBuildInfo.js');
    expect(exists('scripts/license/writeBuildInfo.js')).toBe(true);
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('node scripts/license/writeBuildInfo.js --check');
    expect(release).toContain('--check --dist-dir src-tauri/resources/dist');
    expect(release).not.toMatch(/devkeys|noDevKeys/i);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/devkeys|noDevKeys/i);
  });

  it('keeps __APP_RELEASE_BUILD__ defined by the desktop bundler (channelSeam reads it)', () => {
    expect(read('scripts/desktop/workerBundle.js')).toContain('__APP_RELEASE_BUILD__');
    expect(read('server/license/channelSeam.js')).toContain('__APP_RELEASE_BUILD__');
  });
});

describe('removed tooling is really gone', () => {
  it('has none of the Ed25519 files', () => {
    for (const rel of [
      'server/license/verify.js',
      'server/license/keys.js',
      'server/license/canonicalize.js',
      'server/license/devKeys.json',
      'scripts/license/genKeys.js',
      'scripts/license/mintLicense.js',
      'scripts/checks/noDevKeys.js',
    ]) {
      expect(exists(rel), rel).toBe(false);
    }
  });

  it('the gitleaks config has no Ed25519 or JWK rules and still extends the default rules', () => {
    const toml = read('.gitleaks.toml');
    expect(toml).not.toMatch(/ed25519|okp|local-app-studio-jwk|pkcs8/i);
    expect(toml).not.toContain('[[rules]]');
    expect(toml).toContain('useDefault = true');
  });

  it('the dev key lines are gone from .gitattributes, and the activation file is ignored like the trial and clock files', () => {
    expect(read('.gitattributes')).not.toMatch(/devKeys/);
    for (const name of ['license-clock.json', 'license-trial.json', 'license-activation.json']) {
      expect(read('.gitignore')).toContain(name);
    }
  });

  it('no code or config refers to devKeys.json, mintLicense, verifyLicense, genKeys or noDevKeys', () => {
    const roots = ['server', 'scripts', 'src', 'packages', '.github', '.githooks'];
    const files = ['package.json', '.gitattributes', '.gitleaks.toml', '.gitignore', 'server.js'];
    const skip = new Set(['node_modules', 'dist', 'target']);
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const rel = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else files.push(rel);
      }
    };
    roots.forEach(walk);
    const me = 'server/__tests__/license/noPrivateKeys.test.js';
    const pattern = /devKeys\.json|mintLicense|verifyLicense|genKeys|noDevKeys|check:devkeys/;
    const offenders = files.filter((rel) => rel !== me && isCheckedFile(rel) && pattern.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it('holds no key material in the licensing sources, tests or config', () => {
    const files = ['.gitleaks.toml', '.gitignore', 'package.json', 'server/licenseRoutes.js'];
    for (const root of ['server/license', 'server/__tests__/license', 'scripts/license', 'scripts/checks']) {
      for (const name of fs.readdirSync(path.join(REPO_ROOT, root), { recursive: true })) {
        const rel = path.posix.join(root, String(name).replaceAll('\\', '/'));
        if (fs.statSync(path.join(REPO_ROOT, rel)).isFile()) files.push(rel);
      }
    }
    for (const rel of files.filter(isCheckedFile)) expect(scanText(read(rel)), rel).toEqual([]);
  });
});
