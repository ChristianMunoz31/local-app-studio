// askOutcome.ts is read by the helper's pipeline on the server, so it keeps the ADR-006 syntax (`.ts` on value imports, erasable
// TypeScript only). This loads it under plain Node, the way the sidecar and the dev server do.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { childEnv } from './helpers/childEnv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('src/studio/lib/askOutcome.ts under plain Node', () => {
  it('loads and answers placeAsk', () => {
    const code =
      "import { placeAsk, namedByMove, namesPage } from './src/studio/lib/askOutcome.ts';" +
      "const a = placeAsk('Stack these instead');" +
      'process.stdout.write(JSON.stringify({ flow: a.toFlow, named: typeof namedByMove, page: typeof namesPage }));';
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: childEnv({}), encoding: 'utf8', timeout: 60_000 });
    expect(JSON.parse(out)).toEqual({ flow: true, named: 'function', page: 'function' });
  });
});
