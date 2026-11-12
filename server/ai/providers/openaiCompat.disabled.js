// Stand-in for openaiCompat.js in a build made with APP_CLOUD_AI=off (scripts/desktop/cloudBuild.js).
// It carries no transport, no marker and no wire text. registry.js never reaches it, because
// cloudConfig() answers null when the build has no cloud provider; if something does, it stops here.
import { CloudScopeError } from '../privacy.js';

// Same shape as the real transport (an async generator), but it only ever throws.
// eslint-disable-next-line require-yield
export async function* openaiCompatChatStream() {
  throw new CloudScopeError('cloud_disabled');
}
