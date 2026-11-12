## What changed and why

<!-- One or two sentences. Link the issue if there is one. -->

## Tests

<!--
What tests you added or changed. A change to source in src/ or server/ needs a test that fails without it.
If a test really is not needed, the maintainer can apply the `no-tests-needed` label; put this line (with a real
reason of at least 10 characters) in this description, outside any HTML comment:
No tests needed because: <your reason>
-->

## Screenshots

<!-- UI change: before and after, light and dark. Otherwise write "no UI change". -->

## Checklist

- [ ] PR title is a conventional commit, for example `feat(features): add category filter`
- [ ] `npm run gate` passes (or say which step you could not run and why)
- [ ] Tests added or updated, and `npm test` passes
- [ ] `npm run check:public` passes (no pro code in the public build)
- [ ] Any number sent to a model is computed in code first, with a test proving the model is not asked to calculate
- [ ] A new outbound network call has a `server/netPolicy.js` feature, off by default
- [ ] A new error code has a row in `src/errors/copy.core.js` (or `copy.studio.js`) and in the "Error codes" table in `docs/DESIGN.md`
- [ ] No personal data in code, fixtures, prompts or tests
- [ ] A schema change is a new migration (never an edit to a shipped one) and `migrationSafety` passes
- [ ] Export, import and backups are not gated or weakened
- [ ] No em dashes in code, copy, docs or this description
- [ ] I have signed the Contributor License Agreement (see CONTRIBUTING.md)
