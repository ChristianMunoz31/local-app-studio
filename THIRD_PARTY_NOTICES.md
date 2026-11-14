# Third-party notices

Local App Studio is split by folder. The core (everything outside `packages/runtime/` and `pro/`) is AGPL-3.0
(see `LICENSE`). `packages/runtime/` is MIT (see `packages/runtime/LICENSE`). `pro/` is FSL-1.1-MIT and is not part
of the public source. Third-party code keeps its own license, listed below: fonts, icons, the runtime
that installers include, and the npm production dependencies (generated from the lockfile).

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

91 packages from `package-lock.json` (production only, workspace packages excluded). License mix: MIT (81), ISC (5), OFL-1.1 (2), 0BSD (1), BSD-2-Clause (1), BSD-3-Clause (1).

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @dnd-kit/accessibility | 3.1.1 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/core | 6.3.1 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/sortable | 10.0.0 | MIT | https://github.com/clauderic/dnd-kit |
| @dnd-kit/utilities | 3.2.2 | MIT | https://github.com/clauderic/dnd-kit |
| @fontsource/inter | 5.3.0 | OFL-1.1 | https://github.com/fontsource/font-files |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | https://github.com/fontsource/font-files |
| @tanstack/query-core | 5.104.1 | MIT | https://github.com/TanStack/query |
| @tanstack/react-query | 5.104.1 | MIT | https://github.com/TanStack/query |
| accepts | 2.0.0 | MIT | https://github.com/jshttp/accepts |
| body-parser | 2.3.0 | MIT | https://github.com/expressjs/body-parser |
| bytes | 3.1.2 | MIT | https://github.com/visionmedia/bytes.js |
| call-bind-apply-helpers | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers |
| call-bound | 1.0.4 | MIT | https://github.com/ljharb/call-bound |
| content-disposition | 1.1.0 | MIT | https://github.com/jshttp/content-disposition |
| content-type | 1.0.5 | MIT | https://github.com/jshttp/content-type |
| content-type | 2.1.0 | MIT | https://github.com/jshttp/content-type |
| cookie | 0.7.2 | MIT | https://github.com/jshttp/cookie |
| cookie | 1.1.1 | MIT | https://github.com/jshttp/cookie |
| cookie-signature | 1.2.2 | MIT | https://github.com/visionmedia/node-cookie-signature |
| cors | 2.8.6 | MIT | https://github.com/expressjs/cors |
| debug | 4.4.3 | MIT | https://github.com/debug-js/debug |
| depd | 2.0.0 | MIT | https://github.com/dougwilson/nodejs-depd |
| dotenv | 18.0.5 | BSD-2-Clause | https://github.com/motdotla/dotenv |
| dunder-proto | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto |
| ee-first | 1.1.1 | MIT | https://github.com/jonathanong/ee-first |
| encodeurl | 2.0.0 | MIT | https://github.com/pillarjs/encodeurl |
| es-define-property | 1.0.1 | MIT | https://github.com/ljharb/es-define-property |
| es-errors | 1.3.0 | MIT | https://github.com/ljharb/es-errors |
| es-object-atoms | 1.1.1 | MIT | https://github.com/ljharb/es-object-atoms |
| escape-html | 1.0.3 | MIT | https://github.com/component/escape-html |
| etag | 1.8.1 | MIT | https://github.com/jshttp/etag |
| express | 5.2.1 | MIT | https://github.com/expressjs/express |
| express-rate-limit | 8.7.0 | MIT | https://github.com/express-rate-limit/express-rate-limit |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| finalhandler | 2.1.1 | MIT | https://github.com/pillarjs/finalhandler |
| forwarded | 0.2.0 | MIT | https://github.com/jshttp/forwarded |
| fresh | 2.0.0 | MIT | https://github.com/jshttp/fresh |
| function-bind | 1.1.2 | MIT | https://github.com/Raynos/function-bind |
| get-intrinsic | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic |
| get-proto | 1.0.1 | MIT | https://github.com/ljharb/get-proto |
| gopd | 1.2.0 | MIT | https://github.com/ljharb/gopd |
| has-symbols | 1.1.0 | MIT | https://github.com/inspect-js/has-symbols |
| hasown | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn |
| http-errors | 2.0.1 | MIT | https://github.com/jshttp/http-errors |
| iconv-lite | 0.7.3 | MIT | https://github.com/pillarjs/iconv-lite |
| inherits | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| ip-address | 10.7.3 | MIT | https://github.com/beaugunderson/ip-address |
| ipaddr.js | 1.9.1 | MIT | https://github.com/whitequark/ipaddr.js |
| is-promise | 4.0.0 | MIT | https://github.com/then/is-promise |
| lucide-react | 1.50.0 | ISC | https://github.com/lucide-icons/lucide |
| math-intrinsics | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics |
| media-typer | 1.1.1 | MIT | https://github.com/jshttp/media-typer |
| merge-descriptors | 2.0.0 | MIT | https://github.com/sindresorhus/merge-descriptors |
| mime-db | 1.54.0 | MIT | https://github.com/jshttp/mime-db |
| mime-types | 3.0.2 | MIT | https://github.com/jshttp/mime-types |
| ms | 2.1.3 | MIT | https://github.com/vercel/ms |
| negotiator | 1.1.0 | MIT | https://github.com/jshttp/negotiator |
| object-assign | 4.1.1 | MIT | https://github.com/sindresorhus/object-assign |
| object-inspect | 1.13.4 | MIT | https://github.com/inspect-js/object-inspect |
| on-finished | 2.4.1 | MIT | https://github.com/jshttp/on-finished |
| once | 1.4.0 | ISC | https://github.com/isaacs/once |
| parseurl | 1.3.3 | MIT | https://github.com/pillarjs/parseurl |
| path-to-regexp | 8.4.2 | MIT | https://github.com/pillarjs/path-to-regexp |
| proxy-addr | 2.0.8 | MIT | https://github.com/jshttp/proxy-addr |
| qs | 6.16.0 | BSD-3-Clause | https://github.com/ljharb/qs |
| range-parser | 1.3.0 | MIT | https://github.com/jshttp/range-parser |
| raw-body | 3.0.2 | MIT | https://github.com/stream-utils/raw-body |
| react | 19.3.0 | MIT | https://github.com/react/react |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| react-router | 7.18.4 | MIT | https://github.com/remix-run/react-router |
| react-router-dom | 7.18.4 | MIT | https://github.com/remix-run/react-router |
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
| statuses | 2.0.2 | MIT | https://github.com/jshttp/statuses |
| toidentifier | 1.0.1 | MIT | https://github.com/component/toidentifier |
| tslib | 2.9.1 | 0BSD | https://github.com/Microsoft/tslib |
| type-is | 2.1.0 | MIT | https://github.com/jshttp/type-is |
| unpdf | 1.8.1 | MIT | https://github.com/unjs/unpdf |
| unpipe | 1.0.0 | MIT | https://github.com/stream-utils/unpipe |
| vary | 1.1.2 | MIT | https://github.com/jshttp/vary |
| wrappy | 1.0.2 | ISC | https://github.com/npm/wrappy |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
<!-- generated:end -->
