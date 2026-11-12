# Third-party notices

Local App Studio is split by folder. The core (everything outside `packages/runtime/` and `pro/`) is AGPL-3.0
(see `LICENSE`). `packages/runtime/` is MIT (see `packages/runtime/LICENSE`). `pro/` is FSL-1.1-MIT and is not part
of the public source. Third-party code keeps its own license, listed below: vendored source, fonts, icons, the runtime
that installers include, and the npm production dependencies (generated from the lockfile).

Local App Studio includes source code copied ("vendored") from the open source projects below. Each keeps
its original license. The copies live under `src/vendor/ui-builder/` and may carry local changes; the
changes are listed in `src/vendor/ui-builder/README.md`.

## ui-builder

- Origin: https://github.com/olliethedev/ui-builder (package `ui-builder` 1.0.0, local copy at upstream commit
  `fb42d61d026e83c62e619d06731d907e686c045f`, 2026-06-10).
- Vendored parts: `components/ui/ui-builder/` (editor, `layer-renderer.tsx`, `types.ts`), `lib/ui-builder/`
  (stores, registry definitions, schema utilities), `components/ui/auto-form/`, `hooks/` and the shadcn/ui
  primitives the editor needs from `components/ui/`, plus `lib/utils.ts`.
- License: MIT.

```
MIT License

Copyright (c) 2024 Bennett Hollstein

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui primitives

The primitives under `components/ui/` in the ui-builder copy originate from shadcn/ui
(https://github.com/shadcn-ui/ui), distributed under the MIT License, Copyright (c) 2023 shadcn. They reach
this repository through ui-builder and are covered by the ui-builder notice above and by the shadcn/ui MIT
License, whose terms are identical to the text above apart from the copyright line.

## Fonts and icons

- Fonts: Inter (`@fontsource/inter`) and JetBrains Mono (`@fontsource/jetbrains-mono`) come from npm packages under
  the SIL Open Font License 1.1. They are in the generated table below; the font files are bundled into the built web app.
- Icons: `lucide-react` (ISC) is in the generated table below. The app icons under `src-tauri/icons/` are generated
  from the project's own `source.svg` by `scripts/desktop/icons.js`.

## Runtime that installers include

Installers include the Node.js runtime (the desktop sidecar is a Node single-executable application) and the Rust
crates compiled into the desktop shell (see `src-tauri/Cargo.lock`). Neither is in the table below. Ship the Node.js
LICENSE that matches the Node version used to build the sidecar. pdf.js bundled inside `unpdf` is Apache-2.0
(see `docs/INGEST.md`).

<!-- generated:start (node scripts/release/thirdPartyNotices.js) -->
## npm production dependencies

281 packages from `package-lock.json` (production only, workspace packages excluded). License mix: MIT (269), ISC (6), OFL-1.1 (2), 0BSD (1), Apache-2.0 (1), BSD-2-Clause (1), BSD-3-Clause (1).

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @babel/runtime | 7.29.7 | MIT | https://github.com/babel/babel |
| @date-fns/tz | 1.5.0 | MIT | https://github.com/date-fns/date-fns |
| @dnd-kit/accessibility | 3.1.1 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/core | 6.3.1 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/sortable | 10.0.0 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/utilities | 3.2.2 | MIT | https://github.com/clauderic/dnd-kit |
| @floating-ui/core | 1.8.0 | MIT | https://github.com/floating-ui/floating-ui |
| @floating-ui/dom | 1.8.0 | MIT | https://github.com/floating-ui/floating-ui |
| @floating-ui/react | 0.27.20 | MIT | https://github.com/floating-ui/floating-ui |
| @floating-ui/react-dom | 2.1.9 | MIT | https://github.com/floating-ui/floating-ui |
| @floating-ui/utils | 0.2.12 | MIT | https://github.com/floating-ui/floating-ui |
| @fontsource/inter | 5.3.0 | OFL-1.1 | https://github.com/fontsource/font-files |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | https://github.com/fontsource/font-files |
| @hookform/resolvers | 7.0.1 | MIT | https://github.com/react-hook-form/resolvers |
| @radix-ui/number | 1.1.3 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/primitive | 1.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-accordion | 1.3.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-arrow | 1.1.17 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-checkbox | 1.4.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-collapsible | 1.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-collection | 1.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-context | 1.3.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-dialog | 1.3.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-direction | 1.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-dismissable-layer | 1.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-dropdown-menu | 2.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-focus-guards | 1.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-focus-scope | 1.3.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-id | 1.1.4 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-label | 2.1.17 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-menu | 2.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-popover | 1.3.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-popper | 1.4.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-portal | 1.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-presence | 1.1.11 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-primitive | 2.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-radio-group | 1.5.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-roving-focus | 1.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-select | 2.4.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-separator | 1.2.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-slot | 1.5.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-switch | 1.4.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-tabs | 1.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-toggle | 1.2.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-tooltip | 1.4.1 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-callback-ref | 1.1.5 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-controllable-state | 1.3.0 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-rect | 1.1.4 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-use-size | 1.1.5 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-visually-hidden | 1.2.13 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/rect | 1.1.3 | MIT | https://github.com/radix-ui/primitives |
| @standard-schema/utils | 0.3.0 | MIT | https://github.com/standard-schema/standard-schema |
| @tabby_ai/hijri-converter | 1.0.5 | MIT | - |
| @tanstack/query-core | 5.104.1 | MIT | https://github.com/TanStack/query |
| @tanstack/react-query | 5.104.1 | MIT | https://github.com/TanStack/query |
| @types/debug | 4.1.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/estree | 1.0.9 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/estree-jsx | 1.0.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/hast | 3.0.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/mdast | 4.0.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/ms | 2.1.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/unist | 2.0.11 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/unist | 3.0.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @ungap/structured-clone | 1.3.1 | ISC | https://github.com/ungap/structured-clone |
| @use-gesture/core | 10.3.1 | MIT | https://github.com/pmndrs/use-gesture |
| @use-gesture/react | 10.3.1 | MIT | https://github.com/pmndrs/use-gesture |
| accepts | 2.0.0 | MIT | https://github.com/jshttp/accepts |
| aria-hidden | 1.2.6 | MIT | https://github.com/theKashey/aria-hidden |
| bail | 2.0.2 | MIT | https://github.com/wooorm/bail |
| body-parser | 2.3.0 | MIT | https://github.com/expressjs/body-parser |
| bytes | 3.1.2 | MIT | https://github.com/visionmedia/bytes.js |
| call-bind-apply-helpers | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers |
| call-bound | 1.0.4 | MIT | https://github.com/ljharb/call-bound |
| ccount | 2.0.1 | MIT | https://github.com/wooorm/ccount |
| character-entities | 2.0.2 | MIT | https://github.com/wooorm/character-entities |
| character-entities-html4 | 2.1.0 | MIT | https://github.com/wooorm/character-entities-html4 |
| character-entities-legacy | 3.0.0 | MIT | https://github.com/wooorm/character-entities-legacy |
| character-reference-invalid | 2.0.1 | MIT | https://github.com/wooorm/character-reference-invalid |
| class-variance-authority | 0.7.1 | Apache-2.0 | https://github.com/joe-bell/cva |
| clsx | 2.1.1 | MIT | https://github.com/lukeed/clsx |
| cmdk | 1.1.1 | MIT | https://github.com/pacocoursey/cmdk |
| comma-separated-tokens | 2.0.3 | MIT | https://github.com/wooorm/comma-separated-tokens |
| content-disposition | 1.1.0 | MIT | https://github.com/jshttp/content-disposition |
| content-type | 1.0.5 | MIT | https://github.com/jshttp/content-type |
| content-type | 2.1.0 | MIT | https://github.com/jshttp/content-type |
| cookie | 0.7.2 | MIT | https://github.com/jshttp/cookie |
| cookie | 1.1.1 | MIT | https://github.com/jshttp/cookie |
| cookie-signature | 1.2.2 | MIT | https://github.com/visionmedia/node-cookie-signature |
| cors | 2.8.6 | MIT | https://github.com/expressjs/cors |
| csstype | 3.2.3 | MIT | https://github.com/frenic/csstype |
| data-uri-to-buffer | 4.0.1 | MIT | https://github.com/TooTallNate/node-data-uri-to-buffer |
| date-fns | 3.6.0 | MIT | https://github.com/date-fns/date-fns |
| date-fns | 4.4.0 | MIT | https://github.com/date-fns/date-fns |
| date-fns-jalali | 4.1.0-0 | MIT | https://github.com/date-fns-jalali/date-fns-jalali |
| debug | 4.4.3 | MIT | https://github.com/debug-js/debug |
| decode-named-character-reference | 1.3.0 | MIT | https://github.com/wooorm/decode-named-character-reference |
| depd | 2.0.0 | MIT | https://github.com/dougwilson/nodejs-depd |
| dequal | 2.0.3 | MIT | https://github.com/lukeed/dequal |
| detect-node-es | 1.1.0 | MIT | https://github.com/thekashey/detect-node |
| devlop | 1.1.0 | MIT | https://github.com/wooorm/devlop |
| dotenv | 18.0.5 | BSD-2-Clause | https://github.com/motdotla/dotenv |
| dunder-proto | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto |
| ee-first | 1.1.1 | MIT | https://github.com/jonathanong/ee-first |
| encodeurl | 2.0.0 | MIT | https://github.com/pillarjs/encodeurl |
| es-define-property | 1.0.1 | MIT | https://github.com/ljharb/es-define-property |
| es-errors | 1.3.0 | MIT | https://github.com/ljharb/es-errors |
| es-object-atoms | 1.1.1 | MIT | https://github.com/ljharb/es-object-atoms |
| escape-html | 1.0.3 | MIT | https://github.com/component/escape-html |
| escape-string-regexp | 5.0.0 | MIT | https://github.com/sindresorhus/escape-string-regexp |
| estree-util-is-identifier-name | 3.0.0 | MIT | https://github.com/syntax-tree/estree-util-is-identifier-name |
| etag | 1.8.1 | MIT | https://github.com/jshttp/etag |
| express | 5.2.1 | MIT | https://github.com/expressjs/express |
| express-rate-limit | 8.7.0 | MIT | https://github.com/express-rate-limit/express-rate-limit |
| extend | 3.0.2 | MIT | https://github.com/justmoon/node-extend |
| fast-deep-equal | 3.1.3 | MIT | https://github.com/epoberezkin/fast-deep-equal |
| fetch-blob | 3.2.0 | MIT | https://github.com/node-fetch/fetch-blob |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| finalhandler | 2.1.1 | MIT | https://github.com/pillarjs/finalhandler |
| formdata-polyfill | 4.0.10 | MIT | https://jimmywarting@github.com/jimmywarting/FormData |
| forwarded | 0.2.0 | MIT | https://github.com/jshttp/forwarded |
| fresh | 2.0.0 | MIT | https://github.com/jshttp/fresh |
| function-bind | 1.1.2 | MIT | https://github.com/Raynos/function-bind |
| get-intrinsic | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic |
| get-nonce | 1.0.1 | MIT | https://github.com/theKashey/get-nonce |
| get-proto | 1.0.1 | MIT | https://github.com/ljharb/get-proto |
| gopd | 1.2.0 | MIT | https://github.com/ljharb/gopd |
| has-symbols | 1.1.0 | MIT | https://github.com/inspect-js/has-symbols |
| hasown | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn |
| hast-util-to-jsx-runtime | 2.3.6 | MIT | https://github.com/syntax-tree/hast-util-to-jsx-runtime |
| hast-util-whitespace | 3.0.0 | MIT | https://github.com/syntax-tree/hast-util-whitespace |
| he-tree-react | 1.3.1 | MIT | https://github.com/phphe/he-tree-react |
| helper-js | 3.1.7 | MIT | https://github.com/phphe/helper-js |
| html-url-attributes | 3.0.1 | MIT | https://github.com/rehypejs/rehype-minify/tree/main/packages/html-url-attributes |
| http-errors | 2.0.1 | MIT | https://github.com/jshttp/http-errors |
| iconv-lite | 0.7.3 | MIT | https://github.com/pillarjs/iconv-lite |
| immer | 11.2.9 | MIT | https://github.com/immerjs/immer |
| inherits | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| inline-style-parser | 0.2.7 | MIT | https://github.com/remarkablemark/inline-style-parser |
| ip-address | 10.7.3 | MIT | https://github.com/beaugunderson/ip-address |
| ipaddr.js | 1.9.1 | MIT | https://github.com/whitequark/ipaddr.js |
| is-alphabetical | 2.0.1 | MIT | https://github.com/wooorm/is-alphabetical |
| is-alphanumerical | 2.0.1 | MIT | https://github.com/wooorm/is-alphanumerical |
| is-decimal | 2.0.1 | MIT | https://github.com/wooorm/is-decimal |
| is-hexadecimal | 2.0.1 | MIT | https://github.com/wooorm/is-hexadecimal |
| is-plain-obj | 4.1.0 | MIT | https://github.com/sindresorhus/is-plain-obj |
| is-promise | 4.0.0 | MIT | https://github.com/then/is-promise |
| longest-streak | 3.1.0 | MIT | https://github.com/wooorm/longest-streak |
| lucide-react | 1.50.0 | ISC | https://github.com/lucide-icons/lucide |
| markdown-table | 3.0.4 | MIT | https://github.com/wooorm/markdown-table |
| math-intrinsics | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics |
| mdast-util-find-and-replace | 3.0.2 | MIT | https://github.com/syntax-tree/mdast-util-find-and-replace |
| mdast-util-from-markdown | 2.0.3 | MIT | https://github.com/syntax-tree/mdast-util-from-markdown |
| mdast-util-gfm | 3.1.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm |
| mdast-util-gfm-autolink-literal | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-gfm-autolink-literal |
| mdast-util-gfm-footnote | 2.1.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-footnote |
| mdast-util-gfm-strikethrough | 2.0.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-strikethrough |
| mdast-util-gfm-table | 2.0.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-table |
| mdast-util-gfm-task-list-item | 2.0.0 | MIT | https://github.com/syntax-tree/mdast-util-gfm-task-list-item |
| mdast-util-mdx-expression | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-mdx-expression |
| mdast-util-mdx-jsx | 3.2.0 | MIT | https://github.com/syntax-tree/mdast-util-mdx-jsx |
| mdast-util-mdxjs-esm | 2.0.1 | MIT | https://github.com/syntax-tree/mdast-util-mdxjs-esm |
| mdast-util-phrasing | 4.1.0 | MIT | https://github.com/syntax-tree/mdast-util-phrasing |
| mdast-util-to-hast | 13.2.1 | MIT | https://github.com/syntax-tree/mdast-util-to-hast |
| mdast-util-to-markdown | 2.1.2 | MIT | https://github.com/syntax-tree/mdast-util-to-markdown |
| mdast-util-to-string | 4.0.0 | MIT | https://github.com/syntax-tree/mdast-util-to-string |
| media-typer | 1.1.1 | MIT | https://github.com/jshttp/media-typer |
| merge-descriptors | 2.0.0 | MIT | https://github.com/sindresorhus/merge-descriptors |
| micromark | 4.0.2 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark |
| micromark-core-commonmark | 2.0.3 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-core-commonmark |
| micromark-extension-gfm | 3.0.0 | MIT | https://github.com/micromark/micromark-extension-gfm |
| micromark-extension-gfm-autolink-literal | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-autolink-literal |
| micromark-extension-gfm-footnote | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-footnote |
| micromark-extension-gfm-strikethrough | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-strikethrough |
| micromark-extension-gfm-table | 2.1.1 | MIT | https://github.com/micromark/micromark-extension-gfm-table |
| micromark-extension-gfm-tagfilter | 2.0.0 | MIT | https://github.com/micromark/micromark-extension-gfm-tagfilter |
| micromark-extension-gfm-task-list-item | 2.1.0 | MIT | https://github.com/micromark/micromark-extension-gfm-task-list-item |
| micromark-factory-destination | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-destination |
| micromark-factory-label | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-label |
| micromark-factory-space | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-space |
| micromark-factory-title | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-title |
| micromark-factory-whitespace | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-whitespace |
| micromark-util-character | 2.1.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-character |
| micromark-util-chunked | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-chunked |
| micromark-util-classify-character | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-classify-character |
| micromark-util-combine-extensions | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-combine-extensions |
| micromark-util-decode-numeric-character-reference | 2.0.2 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-numeric-character-reference |
| micromark-util-decode-string | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-string |
| micromark-util-encode | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-encode |
| micromark-util-html-tag-name | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-html-tag-name |
| micromark-util-normalize-identifier | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-normalize-identifier |
| micromark-util-resolve-all | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-resolve-all |
| micromark-util-sanitize-uri | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-sanitize-uri |
| micromark-util-subtokenize | 2.1.0 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-subtokenize |
| micromark-util-symbol | 2.0.1 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-symbol |
| micromark-util-types | 2.0.2 | MIT | https://github.com/micromark/micromark/tree/main/packages/micromark-util-types |
| mime-db | 1.54.0 | MIT | https://github.com/jshttp/mime-db |
| mime-types | 3.0.2 | MIT | https://github.com/jshttp/mime-types |
| ms | 2.1.3 | MIT | https://github.com/vercel/ms |
| negotiator | 1.1.0 | MIT | https://github.com/jshttp/negotiator |
| node-domexception | 1.0.0 | MIT | https://github.com/jimmywarting/node-domexception |
| node-fetch | 3.3.2 | MIT | https://github.com/node-fetch/node-fetch |
| object-assign | 4.1.1 | MIT | https://github.com/sindresorhus/object-assign |
| object-hash | 3.0.0 | MIT | https://github.com/puleos/object-hash |
| object-inspect | 1.13.4 | MIT | https://github.com/inspect-js/object-inspect |
| on-finished | 2.4.1 | MIT | https://github.com/jshttp/on-finished |
| once | 1.4.0 | ISC | https://github.com/isaacs/once |
| parse-entities | 4.0.2 | MIT | https://github.com/wooorm/parse-entities |
| parseurl | 1.3.3 | MIT | https://github.com/pillarjs/parseurl |
| path-to-regexp | 8.4.2 | MIT | https://github.com/pillarjs/path-to-regexp |
| property-information | 7.1.0 | MIT | https://github.com/wooorm/property-information |
| proxy-addr | 2.0.8 | MIT | https://github.com/jshttp/proxy-addr |
| qs | 6.16.0 | BSD-3-Clause | https://github.com/ljharb/qs |
| range-parser | 1.3.0 | MIT | https://github.com/jshttp/range-parser |
| raw-body | 3.0.2 | MIT | https://github.com/stream-utils/raw-body |
| react | 19.3.0 | MIT | https://github.com/react/react |
| react-base-virtual-list | 1.2.9 | MIT | https://github.com/phphe/react-base-virtual-list |
| react-day-picker | 9.14.0 | MIT | https://github.com/gpbl/react-day-picker |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| react-error-boundary | 4.1.2 | MIT | https://github.com/bvaughn/react-error-boundary |
| react-hook-form | 7.91.0 | MIT | https://github.com/react-hook-form/react-hook-form |
| react-markdown | 10.1.0 | MIT | https://github.com/remarkjs/react-markdown |
| react-remove-scroll | 2.7.2 | MIT | https://github.com/theKashey/react-remove-scroll |
| react-remove-scroll-bar | 2.3.8 | MIT | https://github.com/theKashey/react-remove-scroll-bar |
| react-resizable-panels | 2.1.9 | MIT | https://github.com/bvaughn/react-resizable-panels |
| react-router | 7.18.4 | MIT | https://github.com/remix-run/react-router |
| react-router-dom | 7.18.4 | MIT | https://github.com/remix-run/react-router |
| react-style-singleton | 2.2.3 | MIT | https://github.com/theKashey/react-style-singleton |
| react-zoom-pan-pinch | 4.2.0 | MIT | https://github.com/BetterTyped/react-zoom-pan-pinch |
| remark-gfm | 4.0.1 | MIT | https://github.com/remarkjs/remark-gfm |
| remark-parse | 11.0.0 | MIT | https://github.com/remarkjs/remark/tree/main/packages/remark-parse |
| remark-rehype | 11.1.2 | MIT | https://github.com/remarkjs/remark-rehype |
| remark-stringify | 11.0.0 | MIT | https://github.com/remarkjs/remark/tree/main/packages/remark-stringify |
| router | 2.2.0 | MIT | https://github.com/pillarjs/router |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
| send | 1.2.1 | MIT | https://github.com/pillarjs/send |
| serve-static | 2.2.1 | MIT | https://github.com/expressjs/serve-static |
| set-cookie-parser | 2.7.2 | MIT | https://github.com/nfriedly/set-cookie-parser |
| setprototypeof | 1.2.0 | ISC | https://github.com/wesleytodd/setprototypeof |
| side-channel | 1.1.1 | MIT | https://github.com/ljharb/side-channel |
| side-channel-list | 1.0.1 | MIT | https://github.com/ljharb/side-channel-list |
| side-channel-map | 1.0.1 | MIT | https://github.com/ljharb/side-channel-map |
| side-channel-weakmap | 1.0.2 | MIT | https://github.com/ljharb/side-channel-weakmap |
| sonner | 2.0.8 | MIT | https://github.com/emilkowalski/sonner |
| space-separated-tokens | 2.0.2 | MIT | https://github.com/wooorm/space-separated-tokens |
| statuses | 2.0.2 | MIT | https://github.com/jshttp/statuses |
| stringify-entities | 4.0.4 | MIT | https://github.com/wooorm/stringify-entities |
| style-to-js | 1.1.21 | MIT | https://github.com/remarkablemark/style-to-js |
| style-to-object | 1.0.14 | MIT | https://github.com/remarkablemark/style-to-object |
| tabbable | 6.5.1 | MIT | https://github.com/focus-trap/tabbable |
| tailwind-merge | 2.6.1 | MIT | https://github.com/dcastil/tailwind-merge |
| toidentifier | 1.0.1 | MIT | https://github.com/component/toidentifier |
| trim-lines | 3.0.1 | MIT | https://github.com/wooorm/trim-lines |
| trough | 2.2.0 | MIT | https://github.com/wooorm/trough |
| tslib | 2.9.1 | 0BSD | https://github.com/Microsoft/tslib |
| type-is | 2.1.0 | MIT | https://github.com/jshttp/type-is |
| unified | 11.0.5 | MIT | https://github.com/unifiedjs/unified |
| unist-util-is | 6.0.1 | MIT | https://github.com/syntax-tree/unist-util-is |
| unist-util-position | 5.0.0 | MIT | https://github.com/syntax-tree/unist-util-position |
| unist-util-stringify-position | 4.0.0 | MIT | https://github.com/syntax-tree/unist-util-stringify-position |
| unist-util-visit | 5.1.0 | MIT | https://github.com/syntax-tree/unist-util-visit |
| unist-util-visit-parents | 6.0.2 | MIT | https://github.com/syntax-tree/unist-util-visit-parents |
| unpdf | 1.8.1 | MIT | https://github.com/unjs/unpdf |
| unpipe | 1.0.0 | MIT | https://github.com/stream-utils/unpipe |
| use-callback-ref | 1.3.3 | MIT | https://github.com/theKashey/use-callback-ref/ |
| use-sidecar | 1.1.3 | MIT | https://github.com/theKashey/use-sidecar |
| use-sync-external-store | 1.7.0 | MIT | https://github.com/react/react |
| vary | 1.1.2 | MIT | https://github.com/jshttp/vary |
| vfile | 6.0.3 | MIT | https://github.com/vfile/vfile |
| vfile-message | 4.0.3 | MIT | https://github.com/vfile/vfile-message |
| web-streams-polyfill | 3.3.3 | MIT | https://github.com/MattiasBuelens/web-streams-polyfill |
| wrappy | 1.0.2 | ISC | https://github.com/npm/wrappy |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| zundo | 2.3.0 | MIT | https://github.com/charkour/zundo |
| zustand | 4.5.7 | MIT | https://github.com/pmndrs/zustand |
| zwitch | 2.0.4 | MIT | https://github.com/wooorm/zwitch |
<!-- generated:end -->
