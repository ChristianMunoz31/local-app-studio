// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { VENDOR_PREFIX, parseTscOutput, partitionErrors, verdict } from '../../scripts/ci/typecheck.js';

const OUTPUT = [
  "src/studio/lib/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  '  The expected type comes from property x.',
  "src\\studio\\pages\\B.tsx(3,1): error TS2304: Cannot find name 'q'.",
  "src/vendor/ui-builder/x.tsx(40,9): error TS7006: Parameter 'p' implicitly has an 'any' type.",
  './src/vendor/ui-builder/y.ts(1,1): error TS2307: Cannot find module.',
  'Found 4 errors in 4 files.',
  '',
].join('\n');

describe('parseTscOutput', () => {
  it('reads path, position, code and message, skips continuation and summary lines', () => {
    const errors = parseTscOutput(OUTPUT);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toEqual({ file: 'src/studio/lib/a.ts', line: 12, col: 5, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." });
  });

  it('normalizes Windows separators and a leading ./', () => {
    const files = parseTscOutput(OUTPUT).map((e) => e.file);
    expect(files).toContain('src/studio/pages/B.tsx');
    expect(files).toContain('src/vendor/ui-builder/y.ts');
  });

  it('handles CRLF output and empty output', () => {
    expect(parseTscOutput("src/a.ts(1,2): error TS1: x\r\n")).toHaveLength(1);
    expect(parseTscOutput('')).toEqual([]);
  });

  it('does not treat warnings or prose as errors', () => {
    expect(parseTscOutput('src/a.ts(1,2): warning TS1: x\nFound 0 errors.')).toEqual([]);
  });

  it('reads an error with no file location as a blocking error with no file', () => {
    const errors = parseTscOutput('error TS18003: No inputs were found in config file.');
    expect(errors).toEqual([{ file: '', line: 0, col: 0, code: 'TS18003', message: 'No inputs were found in config file.' }]);
    expect(partitionErrors(errors).blocking).toHaveLength(1);
  });
});

describe('partitionErrors', () => {
  it('fails on anything outside src/vendor/ and only counts the vendored ones', () => {
    const { blocking, vendor } = partitionErrors(parseTscOutput(OUTPUT));
    expect(blocking.map((e) => e.file)).toEqual(['src/studio/lib/a.ts', 'src/studio/pages/B.tsx']);
    expect(vendor).toHaveLength(2);
    expect(VENDOR_PREFIX).toBe('src/vendor/');
  });

  it('a path that merely contains vendor is not vendored', () => {
    const { blocking } = partitionErrors(parseTscOutput('src/studio/vendor/a.ts(1,1): error TS1: x\nsrc/vendorish/a.ts(1,1): error TS1: x'));
    expect(blocking).toHaveLength(2);
  });
});

describe('verdict', () => {
  it('passes when every error is vendored, also when tsc exits 2', () => {
    const out = "src/vendor/a.ts(1,1): error TS1: x\n";
    expect(verdict({ status: 2, output: out }).code).toBe(0);
  });

  it('fails on one error outside the vendored folder', () => {
    expect(verdict({ status: 2, output: OUTPUT }).code).toBe(1);
  });

  it('passes a clean run', () => {
    expect(verdict({ status: 0, output: '' })).toMatchObject({ code: 0, blocking: [], vendor: [] });
  });

  it('fails a crash or config error that printed no parsable error, so an unreadable result is never a pass', () => {
    expect(verdict({ status: 1, output: 'error TS5058: The specified path does not exist' }).code).toBe(1);
    expect(verdict({ status: null, output: '' }).code).toBe(1);
  });

  it('fails a location-free error even when vendored errors are also present', () => {
    const vendor = 'src/vendor/a.ts(1,1): error TS1: x';
    expect(verdict({ status: 2, output: `${vendor}\nerror TS18003: No inputs were found` }).code).toBe(1);
    expect(verdict({ status: 1, output: `${vendor}\nerror TS5023: Unknown option` }).code).toBe(1);
  });

  it('fails a spawn error, a signal or a missing status even with a clean or vendor-only output', () => {
    const vendorOnly = 'src/vendor/a.ts(1,1): error TS1: x\n';
    expect(verdict({ status: null, output: vendorOnly, error: new Error('ENOBUFS') }).code).toBe(1);
    expect(verdict({ status: 0, output: '', error: new Error('spawn failed') }).code).toBe(1);
    expect(verdict({ status: null, output: vendorOnly, signal: 'SIGKILL' }).code).toBe(1);
    expect(verdict({ status: null, output: vendorOnly }).code).toBe(1);
  });
});
