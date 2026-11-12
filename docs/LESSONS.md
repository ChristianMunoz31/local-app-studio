# Lessons learned

Rules that ten phases of critiques, gate runs, budgets and process notes taught, each with its evidence and what enforces it. Read this before planning a phase, writing a brief or reviewing.

How to read an entry. **Evidence** names the phase, the finding ids and the commits. Finding ids (`C-founder-2`, `G-11`, `B-3`, `G26-06` and the like) are the maintainer's design-note ids; the notes are not part of this repo. Commit shas are only those quoted by those sources. **Enforced by** names a test, script or check that exists in the repo (each name was searched for in the tree when this file was last checked), or says "not enforced yet". Tests are named by their `describe` or `it` title, not by line number, because lines drift.

Contents: Product (P1 to P6), Helper and model (kept with the helper, pro), Process (R1 to R9), Testing (T1 to T6), Budget (B1 to B6).

## Product

**P1. Say only what the diff shows.** Compute every Done, Not done, It also changed and Not made line from the spec diff in code, never from the model's own summary, and never claim more than was done. This was the most repeated finding of three critique rounds.
- Evidence: phase 17 C-founder-2, C-founder-4, C-freelancer-2, C-freelancer-4; phase 23 F-4 (G-11), F-9, Fo-17 (G-27); phase 26 B-3, B-6, T-3, T-5, T-7, T-9, L-4, L-8 (G26-06, HIGH), then B-V-1, T-V-1, L-V-5, L-V-6; commit 09369ed ("Done judged from the named page or table diff").
- Enforced by: `src/studio/lib/askOutcome.ts` and `notMade.ts` with `src/studio/lib/__tests__/askOutcome.test.ts`, `askOutcomeTruth.test.ts`, `askOutcomePlace.test.ts`, `notMade.test.ts`, and `server/__tests__/askOutcomeServerImport.test.js`. Whether one test exists per sentence kind was not checked.

**P2. Code owns identity.** Restore any table, field or page the ask did not name; a reply never removes what no remove clause named, and a rename is never a delete plus an add.
- Evidence: phase 17 and phase 26 critique findings (the ids are in the maintainer's private notes); the helper's own notes are kept with the helper (pro).
- Enforced by: the helper's keep rules in code, tested by the helper's tests (pro).

**P3. One renderer for every surface.** The canvas, Preview and the installed app draw through one renderer and one theme scope; a difference between surfaces is a defect, not a "canvas only" look.
- Evidence: phase 23 G-01 to G-06 (fixed, per the maintainer's phase 23 status note); phase 17 C-founder-6, C-founder-7, C-maker-14; phase 26 B-V-8, T-V-11, L-15, T-V-10.
- Enforced by: partly. `packages/runtime/src/runtime/SpecRenderer.jsx` is the shared renderer and `src/components/shared/portalScope.js` (`PortalScopeContext`, read by `Modal.jsx`, provided by `PreviewTab.tsx`) carries the app's look to dialogs. Tests: `packages/runtime/src/runtime/__tests__/specRendererParity.test.tsx` (old layouts render the phase 8 markup) and `specFuzzRender.test.tsx`. No test compares the canvas, Preview and the installed app, and none names `portalScope` apart from the pro `templateParity.test.js` file list. Not enforced yet as a parity test.

**P4. Every table gets a way in, and every field type is checked.** A first design is finished with a create Form for each listed table that nothing adds to, and the helper's field types are corrected in code.
- Evidence: phase 17 C-freelancer-9 (13 actions for two buttons), C-founder-7, C-maker-8; phase 23 G-26, G-29; phase 26 B-4, T-4, L-6, L-7, T-6, B-V-8, T-V-12 (G26-15, G26-16); `waysIn` is phase 25.
- Enforced by: `src/studio/lib/waysIn.ts` with `src/studio/lib/__tests__/waysIn.test.ts`; the helper's code repairs and finishing step are enforced by the helper's tests (pro). A rule that every link shows a title field is not enforced yet as such.

**P5. No id or validator sentence reaches the screen, and words follow a rename.** Every code gets a copy row, and Studio-made words are rewritten when a table or field changes. The app name stays a person's choice.
- Evidence: phase 17 C-maker-2, C-maker-3, C-maker-4, C-freelancer-3; phase 23 G-15, G-16; phase 26 B-16, T-21, L-18 (G26-24, still open), T-11 (G26-22), L-19.
- Enforced by: `server/__tests__/errorCopyCoverage.test.js` and `designErrorRows.test.js` (copy rows, `src/errors/copy.core.js`, `copy.studio.js`); `src/studio/lib/followWords.ts` with `src/studio/lib/__tests__/followWords.test.ts`. Machine-made app names (G26-24) and words after a table rename (G26-22) are listed as open in the inventory (Part C row O18): not enforced yet.

**P6. Every number the Assistant states is checked against a tool result.** "AI summarizes, code calculates" includes the reply text: ground each number, and record a declined save as declined.
- Evidence: phase 26 B-12 (25 against 31), T-14, T-15, L-9, T-17, B-V-4, T-V-4 (G26-07, G26-08, HIGH); fixes 2bffdac, 636f006, c8ad445.
- Enforced by: `server/agents/numberGround.js` (`withNumberGround`) with `server/__tests__/numberGround.test.js`; `refusedRead.js` with `refusedRead.test.js`; `changeClaim.js` with `changeClaim.test.js`; the declined sentence in history in `server/__tests__/runtime/assistantRuntime.test.js` (the describes "a declined or approved save is not data in later turns (B-V-4)" and "stored tool rows belong to their own call (RV26-31, RV26-32)"). Known limits of the guard are in `docs/AI_BOUNDARY.md` section 5.

## Helper and model

The helper lessons are kept with the helper (pro, not in the public source).

## Process

**R1. Commit before every heavy step and tick STATUS rows as you go.** Orchestrators are cut off (hand-back limits, usage limits, running out of room) and resume from disk.
- Evidence: phase 18 two forced hand-backs; phase 22 ran out of room before its gates; phase 23 cut twice; phases 24 and 25 once each (workspace OVERVIEW); phase 26 kept 40 ticked rows.
- Enforced by: `scripts/phase/state.js` prints the resume block (head and branch, uncommitted files, STATUS rows ticked and open, last gate step, ports, running processes; read only). Committing before a heavy step stays a habit, not a check.

**R2. Run at most two phases beside each other, and only one in its gate.** Overlap makes load flakes and long shards. Heavy steps go through the shared lock of `scripts/phase/wait.js`, never a private poll.
- Evidence: phase 23 public e2e 2 of 2 took 459 s with 5 flakes while phase 26 ran heavy steps, against 91 to 112 s in phases 24 and 25 (gate JSON); phase 24 first gate 81.4 min wall for 36.7 min of steps (gate JSON, 3 e2e shards).
- Enforced by: `scripts/phase/gate.js` (`--wait-for <worktree>|any`, default `any`; `scripts/phase/lib/waitFor.js`; `docs/PIPELINE.md`, "The phase gate"). `scripts/phase/wait.js` is the one wait command and heavy-step lock for the gate, critics and phase runners (`--max-wait`, exit 75 when still busy), and the phase gate takes that lock for each heavy step (`scripts/phase/gate.js`, importing `tryAcquire` and `release` from `wait.js`). `scripts/phase/ports.js` is the port registry (`--allocate`, `--free`, `--check`).

**R3. Classify flakes by rerunning alone, and never weaken a test.** Quarantine only a test that is flaky in two runs in a row; cite `flakyReport.js list` in a brief, not a hand list. A serial spec file is rerun as a file.
- Evidence: 815a968 (the gate could not rerun a serial file); quarantine did not exist on main before phase 24 (workspace OVERVIEW phase 24, AUTOMATION C9).
- Enforced by: `scripts/ci/gateClassify.js`, `gateState.js` and the default `--classify-flakes` of `scripts/phase/gate.js` (`--no-classify-flakes` turns it off); `scripts/ci/flakyReport.js` (`list`); rules in `docs/PIPELINE.md`, "Classifying a failure" and "Quarantine".

**R4. Every gate is the gate script, and a "Gates at" block is pasted from its output.** Never retype numbers.
- Evidence: phases 24 and 25 ran 41 steps in 48 to 49 min wall with no typed numbers (gate JSON); AUTOMATION C1.
- Enforced by: `scripts/phase/gate.js` (`--json`, `--md`) and the render tests `server/__tests__/phaseGateRender.test.js`, `phaseGatePlan.test.js`, `phaseGateState.test.js`. Pasting the `--md` block is a habit, not a check.

**R5. Run the cleanup dry run first, and fix a defect in the script rather than bypass it.** `cleanup.js --force` refused its own process as a holder (L24-14) and the parent used `git worktree remove` by hand.
- Evidence: workspace OVERVIEW phase 24; `docs/DEBUGGING.md`, "Removing a phase worktree".
- Enforced by: `scripts/phase/cleanup.js` defaults to a dry run (`docs/PIPELINE.md`, "Phase cleanup"). The L24-14 fix is in `scripts/phase/cleanup.js` (the comment "L24-14: this process ... are not holders" at the holder check, line 315 at this writing): the script's own process, the shell above it and what it started are not holders.

**R6. Briefs carry the owner's words and the product section; facts come from the repo.** Port ranges, the wait rule and budget numbers retyped by hand drift: five different port ranges in ten briefs.
- Evidence: `BRIEF-phase17..26.md` in the workspace (port ranges "above 4480" five times, "4700 to 4799" four, and three other ranges); `Get-CimInstance` wait rule retyped in phases 21, 23, 24, 25, 26.
- Enforced by: `scripts/phase/new.js` writes the facts section of the brief from the repo, the last gate JSON and the quarantine list (worktree, `npm ci`, port block), and `scripts/phase/ports.js` is the one port registry. The owner's words and product section stay by hand.

**R7. The maintainer's merge, record and preview steps become scripts; the decision stays with the maintainer.** Merge messages (905 lines over 14 merges), the OVERVIEW section, the "Gates at" block, the memory paragraph and the preview restart were all by hand, and post hand-back defects were fixed by hand (4270d77, 815a968, def85ef, f860259, 5c13bd6, b34efe6).
- Evidence: workspace `merge-p*.txt` line counts, OVERVIEW phases 17 to 25; AUTOMATION C5 to C7.
- Enforced by: `scripts/phase/merge.js` (composes the merge message from STATUS and the gate JSON; merges only with `--yes`), `scripts/phase/record.js` (appends the "Gates at" block and a decision draft, writes the memory paragraph draft) and `scripts/phase/preview.js` (the owner's preview restart by pid after a command-line check). The decision to merge and the narrative stay with the maintainer.

**R8. Run the real-model eval one case at a time with one model loaded.** Start `ollama serve` with `OLLAMA_MAX_LOADED_MODELS=1`, run `--only <id>` per call, merge the JSON per model. One case was stopped by the system for low memory.
- Evidence: OQ-22-4; one case was stopped for low memory in phase 26; the eval notes are kept with the helper (pro).
- Enforced by: the eval runner and its memory-safe loop, both pro, and the helper's tests (pro). The one-case-per-child-process loop goes through the heavy-step lock of `scripts/phase/wait.js`.

**R9. A critic's recipe is a script with a smoke test, and a critic never edits it.** Harness defects cost rounds: the sandbox hides Rust (G-32), a fresh worktree has no template ZIP (G-33), scripts pressed Use this on bad designs (B-17), the build poller died at exit 255 (T-20), and `taskkill /T` without `/F` does not close a WebView2 app.
- Evidence: phase 23 and phase 26 critiques; `RECIPE-phase26` notes in the workspace.
- Enforced by: not enforced yet in this repo. The recipe scripts (`startDirect.mjs`, `api.mjs`) live under the workspace `phase26\scripts\`, outside the repo.

## Testing

**T1. Treat a flake seen only under overlap as a scheduling defect, not a test defect.** Every classified flake in five gate runs passed alone, and they cluster in runs that overlapped another phase.
- Evidence: gate JSON of phases 23 to 26 (16 flaky entries, none real); phase 23 public 2 of 2, five flakes in one shard.
- Enforced by: the rerun-alone classification in `scripts/ci/gateClassify.js` (see R3); the overlap rule is R2.

**T2. Root-cause the files that flake most, in one pass.** The repeat offenders are `designNewTable.test.tsx` (4 runs), `backups.spec.js:8` (3), `DataTab.test.tsx:268` (3) and `indicator.spec.js:81` (2).
- Evidence: STATUS files and gate JSON of phases 17 to 25; L24-13 (the dialog wait under CPU contention); `requestId.test.js` fixed in def85ef.
- Enforced by: `scripts/ci/flakyReport.js` records and lists them. Phase 27 ran the four files ten times each: 10 of 10 alone and green under a parallel run. No fix was made: the cause is overlap load (T1, R2) (the maintainer's phase 27 status note).

**T3. No timing waits; every wait is on a shown sentence or a lit drop place.** The only two real e2e failures of the window were a timing locator (4270d77) and a serial-file rerun (815a968). Keep serial files short: a failure skips the rest of the file.
- Evidence: workspace OVERVIEW phase 23; 38 e2e spec files use `mode: 'serial'` (counted in `e2e/`).
- Enforced by: not enforced yet. `waitForTimeout` is still in `e2e/flows/critiqueLeave.spec.js` (test "N2") and `e2e/visual/p16Shots.spec.js`.

**T4. Split the slow frontend files so the workers balance.** `DesignTab.test.tsx` (119 to 238 s), `newParts.test.tsx` (73 to 168 s), `designNewTable.test.tsx` (36 to 144 s) and `FeatureBuilderPage.test.tsx` (52 to 123 s) make the unit frontend step 255 to 412 s for 678 to 1170 s of file time; the longest file is the floor.
- Evidence: `*-unit-frontend.log` slowest reporter output, phases 23 to 26 (workspace gate logs).
- Enforced by: `scripts/ci/slowestReporter.js` prints the ten slowest tests every unit run (`docs/DEBUGGING.md`). The split landed in phase 27: `DesignTab.test.tsx` became 6 files (`DesignTab.test.tsx`, `.settings`, `.connections`, `.draft`, `.pages`, `.look`, sharing `designTabHarness.tsx`), `newParts` 3 (`newParts.test.tsx`, `.layout`, `.choices`, with `newPartsHarness.tsx`), `designNewTable` 2 (`designNewTable.test.tsx`, `.dialog`, with `designNewTableHarness.tsx`) and `FeatureBuilderPage` 3 (`FeatureBuilderPage.test.tsx`, `.keys`, `.saving`, with `featureBuilderHarness`). The frontend step went from 336.8 s to 303.2 s, measured by `scripts/ci/measureRun.js`.

**T5. Shard the accessibility project by route.** It is one file, `studioAxe.spec.js`, 120 to 215 s of a 125 to 243 s step.
- Evidence: `*-e2e-a11y.log`, phases 23 to 25 (workspace gate logs).
- Enforced by: five route shard files in `e2e/a11y/` (`studioAxeApps`, `studioAxeDesign`, `studioAxeFeatures`, `studioAxePrompt`, `studioAxeSteps` `.spec.js`, sharing `studioAxeShared.js`). The a11y step went from 149.7 s to 64.4 s.

**T6. Judge a load timeout against the measured preview start.** The harness waits 30 s for "Your app is running." and a Preview child starts in 9 to 12 s on a quiet machine.
- Evidence: `e2e/pages/preview.js` (`timeout: 30_000` on "Your app is running." at line 7 and on "The preview is stopped." at line 32); phase 26 critiques (Preview 9 to 12 s); phase 20 "preview-start timeouts".
- Enforced by: `e2e/support/previewStartReporter.js` (a per-run preview-start line) next to the fixed 30 s timeouts in `e2e/pages/preview.js`. The timeouts themselves are not tied to the measurement.

## Budget

**B1. A UI phase states its byte plan in the brief and the measured delta in STATUS; over plan by more than 50 percent is a review finding.** The pro web total went from 486.25 KiB (phase 17) to 529.22 (phase 26 head) of 530.
- Evidence: workspace OVERVIEW "Gates at" 9a785e7, dd26ed8, 946dc9f, 2963ad8, a7f0a47, 815a968; phase 25 was 1.4 and 3.3 KiB against 0.9 and 2.0 planned; `docs/BUDGETS.md` live table.
- Enforced by: `npm run check:bundle` (`scripts/checks/bundle-budget.json`, `server/__tests__/ciPipeline.test.js`) stops an overrun, not a plan miss. The plan rule is not enforced yet.

**B2. Name the sidecar cost of helper code in the brief, and look for a cut before a raise.** Helper code is pro and ships in the Studio sidecar only. The studio sidecar gzip went from 1128.42 (phase 17) to 1140.33 (phase 23) to 1156.71 at the base, over the 1153 limit.
- Evidence: the maintainer's phase 27 design note; phase 26 sidecar log "OVER" and status note (31ea7b8 reached 1156.68 by a trim).
- Enforced by: `npm run check:sidecar` (`scripts/checks/sidecar-budget.json`, pinned by `server/__tests__/ciPipeline.test.js` and `sidecarBudget.test.js`). The check prints a module table (`moduleTable` in `scripts/checks/sidecarBudget.js`, top 30 input files from the esbuild metafile), and `scripts/desktop/dedupePackages.js` bundles one copy of mime-db, mime-types and content-type (`server/__tests__/dedupePackages.test.js`).

**B3. Turn a "Needs a decision" line into an owner question with a recommended number, and never let the gate raise.** The three lines were due by arithmetic since phase 21, first printed by the phase 24 gate, and nobody acted for four phases.
- Evidence: AUTOMATION-insights header (workspace); the maintainer's phase 24 and phase 26 status notes.
- Enforced by: `scripts/ci/gateLedger.js` prints the line and `server/__tests__/gateNoSelfRaise.test.js` fails when a write call in `scripts/ci/*.js` names a limit file, a pin, a test or a workflow, when `gateRepair.js` does more than one commit with its fixed subject or any push, or when the CI `verify` job can commit or push (`docs/BUDGETS.md`, Rules). Acting on the line is not enforced.

**B4. Say "cut" or "raise", never "split", when the total is the problem.** The web total counts every chunk, lazy or not; a split only helps the initial budget.
- Evidence: `scripts/checks/bundleBudget.js` (`totalJsGzipKb` is the gzip sum of all JS); inventory Part B2 (79 chunks).
- Enforced by: `scripts/checks/bundleBudget.js` measures it that way; the wording is a convention (`docs/BUDGETS.md`, Rules).

**B5. Shorten a sentence before adding a part or a rule to the helper prompt.** The helper prompt has little headroom at the worst case, and every call carries the catalog text.
- Evidence: helper prompt budgets are kept with the helper (pro, not in the public source).
- Enforced by: the helper's size tests (pro).

**B6. Before raising a sidecar or web limit, read the module table and look for the same package installed twice.** A limit raise buys no headroom that a duplicate does not already waste.
- Evidence: phase 27 found mime-db 1.54.0 bundled four times; deduping freed 73.03 KiB gzip of the studio sidecar (1156.69 to 1083.66) and the runtime sidecar went from 1035.47 to 962.36 (`check:sidecar`).
- Enforced by: the module table in `npm run check:sidecar` (`moduleTable`, `scripts/checks/sidecarBudget.js`) and `scripts/desktop/dedupePackages.js` with `server/__tests__/dedupePackages.test.js`. Reading the table before a raise is a habit, not a check.
