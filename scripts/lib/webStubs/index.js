// Web build stubs: a Vite plugin that swaps three installed modules for small stubs, for `vite build` of the web app only (vite.config.js passes
// it when command is "build"). Vitest, the esbuild sidecar bundles (scripts/desktop/buildSidecar.js) and Node never see it.
//   1. zod 4 classic puts toJSONSchema on every schema, which pulls core/to-json-schema.js and core/json-schema-processors.js into the web chunk
//      (about 5.2 KiB gzip). Only pro/src/catalog/modelSchema.ts (server code) calls it.
//   2. remark-gfm registers a to-markdown extension that pulls mdast-util-to-markdown and the five gfm ToMarkdown factories into the lazy Markdown
//      chunk. react-markdown only parses, so the stub for mdast-util-gfm keeps gfmFromMarkdown and returns no to-markdown extensions.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (file) => fileURLToPath(new URL(file, import.meta.url)).replaceAll(path.sep, '/');

/** Installed module (path tail under node_modules, forward slashes) mapped to its stub file. Relative zod imports are matched on the resolved path. */
export const WEB_STUB_FILES = Object.freeze({
  'node_modules/zod/v4/core/to-json-schema.js': here('./zodToJsonSchema.js'),
  'node_modules/zod/v4/core/json-schema-processors.js': here('./zodJsonSchemaProcessors.js'),
});

/** The bare specifier replaced for remark-gfm and the stub file it gets. */
export const WEB_STUB_BARE = Object.freeze({
  'mdast-util-gfm': here('./mdastUtilGfm.js'),
});

const stubFor = (source, importer) => {
  if (Object.hasOwn(WEB_STUB_BARE, source)) return WEB_STUB_BARE[source];
  if (!importer || !source.startsWith('.')) return null;
  const resolved = path.posix.resolve(path.posix.dirname(importer.replaceAll(path.sep, '/')), source);
  for (const [tail, stub] of Object.entries(WEB_STUB_FILES)) if (resolved.endsWith(`/${tail}`)) return stub;
  return null;
};

/** The Vite plugin. `resolveId` runs before the default resolver; the stubs themselves are never rewritten. */
export function webStubsPlugin() {
  return {
    name: 'las-web-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      const stub = stubFor(source, importer);
      return stub && importer?.replaceAll(path.sep, '/') !== stub ? stub : null;
    },
  };
}
