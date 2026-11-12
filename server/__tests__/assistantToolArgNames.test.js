// Guard for the wrapper/echo heuristics in server/agents/toolCalls.js (cleanCallArgs): a tool
// parameter named like one of these keys would be read as a call wrapper or a schema echo and
// silently dropped or unwrapped.
import { describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS } from '../agents/assistantTools.js';

const RESERVED = ['function', 'type', 'properties', 'arguments', 'parameters', 'args'];

describe('ASSISTANT_TOOLS parameter names', () => {
  it('never use a name that cleanCallArgs treats as a call wrapper or schema echo', () => {
    const clashes = [];
    for (const t of ASSISTANT_TOOLS) {
      for (const key of Object.keys(t.function.parameters?.properties || {})) {
        if (RESERVED.includes(key)) clashes.push(`${t.function.name}.${key}`);
      }
    }
    expect(
      clashes,
      `Tool parameters named ${RESERVED.join(', ')} collide with the wrapper/echo heuristics in cleanCallArgs (server/agents/toolCalls.js): a call using them would be unwrapped or have its arguments dropped. Rename the parameter, or change the heuristics first. Offending: ${clashes.join(', ')}`,
    ).toEqual([]);
  });
});
