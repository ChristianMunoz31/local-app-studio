# Feature workflow

How a repo owner gets features and fixes into the app with Claude Code. The full picture is in [PIPELINE.md](PIPELINE.md). The commands live in `.claude/commands/`.

The commands delegate to specialist agents (architect, coder, tester, reviewer, debugger, qa-lead) when you have them. If you do not, Claude Code does each step itself in the same order.

## Ship a feature

In Claude Code, in the main checkout:

```
/ship-feature <what you want, in plain language>
```

The run has stop conditions at each step:

1. A short spec is written and checked against [PRODUCT.md](PRODUCT.md) (the hard rules and "first run just works"). If it conflicts or needs a decision from you, it stops and asks.
2. A worktree `../app-wt-<slug>` on `feat/<slug>` is created from `origin/main`. Your main checkout is never used.
3. The feature is built with unit tests and, when it is user-visible, Playwright tests. Only fake AI, temp data and no network.
4. Four parallel reviews (security, UI and accessibility, "AI summarizes, code calculates", privacy and `netPolicy`), then severity is assigned. Critical and high findings block; up to 3 fix rounds, then it asks you.
5. Screenshots of changed screens (light and dark) are saved in your temp folder from a fake-AI sandbox. `gh` cannot attach images, so their paths are listed in the PR.
6. A PR with a conventional-commit title opens.

## Fix an issue

```
/fix-issue <issue number>
```

It reads the issue, reproduces the bug first, writes the root cause into the PR, adds a regression test that failed before the fix, then follows the same review, PR and merge path. The PR body starts with `Fixes #<n>`.

## What you get back

- The PR link, a two-sentence spec or root cause, tests added, review notes, and whether it will auto-merge.
- A sticky PR bot comment with the CI summary and a 3-day link to the built UI.
- A local preview on demand: `npm run preview:branch -- "#<n>"` (then `npm run preview:clean`).

## What to look at

- The spec in the PR body and the product rules checklist.
- The preview, for anything you can see or click.
- The review notes (low and info findings the agents left for you).
- Any line saying "needs a human merge" or a changed visual baseline.

## How to stop a merge

Add the label `hold` to the PR. The bot never merges a held PR and never removes the label. Doing nothing means "ship it": once all required checks are green, the PR is squash-merged. Remove `hold` later to let it merge.

PRs that touch gate files (`.github/**`, `scripts/ci/**`, `scripts/checks/**`, test configs, release config) and release PRs are never auto-merged; you merge them.

## How to waive tests

A change to `src/` or `server/` needs a test change, or both of:

- the label `no-tests-needed`, and
- a line in the PR body: `No tests needed because: <reason>` (at least 10 characters).

The label only counts when you (the repo owner) add it; agents ask you instead. The waiver also covers the changed-files coverage floor: that CI step still fails, and the PR bot accepts the failure only with a valid waiver, then leaves the merge to you.

## Setup you do once

- Create the labels the pipeline uses (`hold`, `no-tests-needed`, `flaky`, `good-first-task`): `node scripts/setupLabels.js` (needs `gh` signed in).
- `npm ci` in the main checkout, so the commands and scripts exist.
- Set the release secret and edit `config/release.json` before your first release (see [RELEASING.md](RELEASING.md)).

## Safety rules the agents follow

Worktree only; never your real data folder; never the real Ollama (fake by default); never real store, payment or cloud APIs; no personal data; no em dashes; no force-push.
