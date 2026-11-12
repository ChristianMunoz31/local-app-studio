import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { childEnv } from '../helpers/childEnv.js';
import { previewEnvProblem, roleFromArgv, withoutRoleArgs } from '../../role.js';

const ENTRY = fileURLToPath(new URL('../../entry.js', import.meta.url));
const abs = process.platform === 'win32' ? 'C:\\spec.json' : '/spec.json';

describe('roleFromArgv', () => {
  it('accepts parser and preview, rejects unknown and repeated roles', () => {
    expect(roleFromArgv(['node', 'entry.js'])).toBeNull();
    expect(roleFromArgv(['node', 'entry.js', '--role', 'preview'])).toBe('preview');
    expect(roleFromArgv(['node', 'entry.js', '--role=preview'])).toBe('preview');
    expect(roleFromArgv(['node', 'entry.js', '--role', 'parser'])).toBe('parser');
    expect(() => roleFromArgv(['node', 'entry.js', '--role', 'preview', '--role=parser'])).toThrow(/only once/);
    expect(() => roleFromArgv(['node', 'entry.js', '--role', 'other'])).toThrow(/Supported roles/);
    expect(() => roleFromArgv(['node', 'entry.js', '--role'])).toThrow();
  });
});

describe('previewEnvProblem', () => {
  it('names the first problem and is null when all is well', () => {
    expect(previewEnvProblem({ APP_MODE: 'runtime', APP_SPEC_PATH: abs }, undefined)).toBeNull();
    expect(previewEnvProblem({ APP_MODE: 'runtime', APP_SPEC_PATH: abs }, 'studio')).toBeNull();
    expect(previewEnvProblem({ APP_MODE: 'runtime', APP_SPEC_PATH: abs }, 'runtime')).toMatch(/only in Local App Studio/);
    expect(previewEnvProblem({ APP_SPEC_PATH: abs }, undefined)).toMatch(/APP_MODE=runtime/);
    expect(previewEnvProblem({ APP_MODE: 'studio', APP_SPEC_PATH: abs }, undefined)).toMatch(/APP_MODE=runtime/);
    expect(previewEnvProblem({ APP_MODE: 'runtime' }, undefined)).toMatch(/APP_SPEC_PATH/);
    expect(previewEnvProblem({ APP_MODE: 'runtime', APP_SPEC_PATH: '   ' }, undefined)).toMatch(/APP_SPEC_PATH/);
    expect(previewEnvProblem({ APP_MODE: 'runtime', APP_SPEC_PATH: 'relative/spec.json' }, undefined)).toMatch(/absolute/);
  });
});

describe('withoutRoleArgs', () => {
  it('drops both forms and keeps everything else', () => {
    expect(withoutRoleArgs(['node', 'entry.js', '--role', 'preview', '--x'])).toEqual(['node', 'entry.js', '--x']);
    expect(withoutRoleArgs(['node', 'entry.js', '--role=preview'])).toEqual(['node', 'entry.js']);
    expect(withoutRoleArgs(['node', 'entry.js'])).toEqual(['node', 'entry.js']);
  });
});

describe('entry.js --role preview', () => {
  it('exits 2 with the APP_MODE message when started without its environment', () => {
    const out = spawnSync(process.execPath, [ENTRY, '--role', 'preview'], { env: childEnv({}), encoding: 'utf8', timeout: 20000, windowsHide: true });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('The preview role needs APP_MODE=runtime.');
  });
});
