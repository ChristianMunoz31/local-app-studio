// A scripted model for the Describe pipeline, used as the `fakeChat` hook of the e2e fake Ollama.
// It answers by the step's JSON schema (tables, outline, page), so it needs no call counter and
// survives repair rounds. The data is a small crew roster, always (so existing flows do not change);
// the answers live in scripts/lib/fakeDescribeAnswers.js, which also picks others by the prompt's words.
import { CREWS } from '../../scripts/lib/fakeDescribeAnswers.js';

/** The `fakeChat` hook: returns the JSON text for whichever Describe step the schema belongs to. */
export function describeFakeChat(body) {
  const props = body?.format && typeof body.format === 'object' ? body.format.properties : undefined;
  if (props?.tables) return JSON.stringify(CREWS.tables);
  if (props?.nav) return JSON.stringify(CREWS.outline);
  return JSON.stringify(CREWS.pages.home);
}
