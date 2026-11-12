// Entry of `npm run desktop:dev` (scripts/desktop/dev.js sets APP_DEV_ENTRY to this file). The shell runs `node <entry>` with a
// minimal environment and no flags, so the pro seam hook (scripts/lib/proHook.js, docs/ARCHITECTURE.md) is registered here, and
// only then is server.js loaded, so its imports resolve to the pro twins in a pro build. It sits at the repo root because the
// shell takes the dist and migrations folders from the entry's folder.
import './scripts/lib/proHook.js';

await import('./server.js');
