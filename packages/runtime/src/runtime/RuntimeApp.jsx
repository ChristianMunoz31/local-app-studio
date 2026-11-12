// What a built app routes its spec pages to (src/modules/runtime.jsx wraps it with the baked spec).
import { SpecApp } from './index.js';

/** @param {{ spec: import('../spec/schema.ts').AppSpec | null, menuTrail?: import('react').ReactNode }} props */
export default function RuntimeApp({ spec, menuTrail = null }) {
  if (!spec) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="glass rounded-2xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-slate-slate100">This app has no spec</h2>
          <p className="text-sm text-slate-slate400">
            There is nothing to show yet. Build the app from a spec in Local App Studio, then open it again.
          </p>
        </div>
      </div>
    );
  }
  return <SpecApp spec={spec} apiBase="/api" basePath="/" menuTrail={menuTrail} />;
}
