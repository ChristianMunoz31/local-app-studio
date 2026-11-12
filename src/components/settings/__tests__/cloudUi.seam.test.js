import { describe, expect, it } from 'vitest';
import * as real from '../cloudUi';
import * as disabled from '../cloudUi.disabled';
import { PUBLIC_BUILD } from '../../../../server/__tests__/helpers/proBuild.js';

// A pro run reads the pro twin through the seam (it adds the PRO_MARKER export); a public run reads the stub, which has the disabled bytes.
const names = (mod) => Object.keys(mod).filter((k) => k !== 'PRO_MARKER').sort();

describe('cloud UI seam', () => {
  it('real and disabled modules export the same names', () => {
    expect(names(disabled)).toEqual(names(real));
  });

  it('the disabled module offers no cloud block', () => {
    expect(disabled.CloudAiBlock).toBeNull();
  });

  it.skipIf(PUBLIC_BUILD)('the real module offers the cloud block (the cloud screens are pro, which is not in a public build)', () => {
    expect(typeof real.CloudAiBlock).toBe('function');
  });

  it.runIf(PUBLIC_BUILD)('a public build gets the disabled module at the seam path', () => {
    expect(real.CloudAiBlock).toBeNull();
  });
});
