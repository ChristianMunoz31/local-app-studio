// The few Node functions the spec tests read fixtures with. The root tsconfig has no Node types, and a test in this folder
// runs under Node (vitest), so this declares just those names instead of widening the types of the whole runtime package.
declare module 'node:fs' {
  export function readFileSync(file: string, encoding: 'utf8'): string;
  export function readdirSync(dir: string): string[];
  const fs: { readFileSync: typeof readFileSync; readdirSync: typeof readdirSync };
  export default fs;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  const path: { dirname: typeof dirname; join: typeof join; resolve: typeof resolve };
  export default path;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
