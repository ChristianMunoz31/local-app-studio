# Licensing

This page is for you, the developer who sells an app built from the kit. The kit includes an optional licensing module so you can charge for a Pro tier: your customers buy a license key from your store (Gumroad, or Lemon Squeezy), paste it into the app, and Pro turns on. Every new data folder also gets an automatic 14-day Pro trial on its first launch (a reverse trial: no click, no card, no account, no network), then drops to Free.

The module is off until you fill in `pro/config/store.json`. With no store configured (every value empty, as shipped) licensing is off: the app reports Pro as on with the state `licensing_off`, the Pro gate passes, no trial starts and there is no Pro prompt, and Settings > License says licensing is not set up. Configure one store and the full behavior below applies. Everything here is read from `pro/server/license/*` and `pro/server/pro.js` (the source-available pro modules, see "What will be open and what stays pro" below); the constants and copy are in `server/license/constants.js` and `messages.js`.

Licensing is a deterrence, not DRM. The app runs on the user's machine, so a determined user can patch any check. The goals are to keep honest people honest, limit casual key sharing, never punish honest users and never lock their data.

## Quick setup (Gumroad)

1. In Gumroad, create your Pro product with "Generate a unique license key per sale" turned on. Add versions (for example Standard, Founding, Family) if you want more than one edition.
2. Copy the product's `product_id` (open the product, Content tab, the license key section).
3. Edit `pro/config/store.json`: put the id in `gumroad.proProductId`, make the names in `gumroad.proVersions` match your Gumroad version names exactly (capital letters count), and set `supportContact` to your support email or URL. Optionally set `proPurchaseUrl` to your public Pro page to show a Buy button (see Buy button below).
4. Run `npm run check:store-config`. It prints whether each store is configured. It never prints the ids and never contacts a store.
5. Make a Dev build (`npm run desktop:build:dev`, see [DEV_CHANNEL.md](DEV_CHANNEL.md)) and test with a Gumroad test purchase. Dev builds accept store test purchases, stable builds refuse them.
6. Decide which features are Pro (see Adding a Pro feature below). The kit ships none; `pro/server/pro.js` keeps one placeholder, `example_pro`, for the gating tests.

No seller token or API key is needed. The app only asks the store whether a key is valid, using the product id, and only when your customer clicks Activate.

## Turning licensing off

Leave `pro/config/store.json` as shipped: every store value empty. Then:

- Pro is on for everyone (state `licensing_off`) and the Pro gate always passes.
- No trial starts (no trial record and no notice row is ever written) and `trial.notice` is always `null`. There is no Pro prompt and no Activate button. Settings > License says licensing is not set up.
- `POST /api/license/trial` answers `410 trial_route_removed` here too, like everywhere else.

Any stored activation or trial record is ignored and left as it is (if you later configure a store, a record that was already there keeps counting). This is how you ship a free or one-time-purchase app, and how you can try the kit before you set up a store. Note that the setting is baked in at build time (see below), so changing it means a new build.

If you fill in a product or store id but make a typing mistake, licensing does not switch off: Pro stays locked until you fix the value. `npm run check:store-config` tells you which store has the problem.

## What the module does

- The user pastes a store license key in Settings > License and clicks Activate. The app asks the store once whether the key is valid, then stores a tamper-protected activation record locally. After that it never contacts the store again, so there is no online check, no timer and no account.
- With a store configured, a new data folder starts a 14-day Pro trial by itself on first launch (see Local trial). A license activated at any time keeps Pro.
- Pro is a capability gate, not a data gate. The kit ships no Pro capability (only the `example_pro` placeholder in `pro/server/pro.js`). Everything else (the user's data, export, import, backups, privacy controls, Network and AI settings, model download, bring-your-own cloud provider, Assistant and its page advice) is free. Keep it that way: never gate your customers' own data.
- No license state blocks any route, page, export, import, backup or data read. A failure always keeps the user's data.

## Configure `pro/config/store.json`

This is the one file with every seller-specific value. It is read at build time: `pro/server/license/storeConfig.js` imports it statically, so the desktop sidecar bundler (esbuild) bakes it into the sidecar, and the source zip carries the file. A buyer cannot turn licensing off by editing a file in their data folder. An empty value turns that store off. A malformed value also turns that store off and one log line names the field (never the value), but it does NOT switch licensing off: once you have filled in a product id or store id, licensing stays on and Pro stays locked until the value is fixed (activation answers `store_not_configured`). Licensing is off only when no store is configured and none was attempted. The shipped placeholders (the support contact, the example version maps) do not count as an attempt, only the product and store ids do.

| Field | Meaning |
| --- | --- |
| `supportContact` | Shown to buyers in error copy, for example an email address or URL. The committed placeholder counts as "not set" |
| `proPurchaseUrl` | Optional, top level. Your public Pro page. An absolute `https` URL with no credentials, port, query string or fragment, at most 200 characters; anything else counts as empty. Empty (as shipped) means no Buy button anywhere. It is shown as a plain link that opens in the user's browser; the app itself never requests it and it is not a store field, so it does not turn licensing on |
| `gumroad.proProductId` | `product_id` of your Pro product. Empty means Gumroad is off |
| `gumroad.proVersions` | Maps Gumroad version names to editions: `{ "Standard": "standard", "Founding": "founding", "Family": "family" }`. Keys must equal the version names in Gumroad exactly (case-sensitive). Never rename a version after you sold it |
| `gumroad.freeLicenseProductId` | Optional second, hidden product for free licenses (for example students or nonprofits). Leave empty if you have none |
| `gumroad.freeLicenseVersions` | `{ "Student": "student", "Nonprofit": "nonprofit" }`, used only if that product has versions |
| `gumroad.freeLicenseDefaultEdition` | `student` or `nonprofit`: the edition given when the free-license product answers with no version |
| `gumroad.maxUses` | Maximum activations per edition: `{ "standard": 3, "founding": 3, "family": 10, "student": 3, "nonprofit": 3 }` (with slack for reinstalls) |
| `lemonSqueezy.storeId` | Store id, as text |
| `lemonSqueezy.productIds` | List of product ids, as text |
| `lemonSqueezy.variantEditions` | `{ "<variant id>": "<edition>" }` where edition is one of `standard`, `founding`, `family`, `student`, `nonprofit` |

Keep the file valid JSON. Product ids are not secret. No seller token, API key or secret is needed or may ever be put in it.

After editing, run:

```powershell
npm run check:store-config
```

It prints whether each store is configured (never the ids). To make a release gate of it, `node scripts/lib/proRun.js scripts/checks/storeConfig.js --require gumroad` exits 1 when that store is not configured.

### Gumroad setup

1. Create your Pro product with the license key option on ("Generate a unique license key per sale"). Add versions named exactly as in `gumroad.proVersions`. Never rename a version.
2. Optional: create a hidden product for free licenses with the license key option on, sold only with single-use 100 percent codes. Its keys resolve to `gumroad.freeLicenseDefaultEdition` unless you add versions named as in `gumroad.freeLicenseVersions`. They are valid for one year from purchase.
3. Copy each product id into `pro/config/store.json` (open the product, Content tab, the license key section shows the `product_id`).
4. Set `supportContact`, and make your refund policy say a refunded key is no longer valid.
5. Run `npm run check:store-config`.
6. Test with a Gumroad test purchase in a Dev build (see Test purchases below).
7. To reset a buyer's activation count: Gumroad dashboard, Sales, open the sale, License key, Uses. There is no way to do this from the app, and the seller token that could must never ship in it.
8. In store copy, describe the product as a desktop app with a built-in helper. Some stores prohibit selling model access, so do not describe it that way.

### Lemon Squeezy setup

The kit supports Lemon Squeezy as a second store (`pro/server/license/stores/lemonSqueezy.js`). You can configure Gumroad, Lemon Squeezy or both, and the buyer picks the store in Settings > License (only configured stores are shown).

Create one product with a variant per edition, license keys on per variant, and activation limits that match your design. Give free editions their own variants: the License API does not show discount codes, so the variant decides the edition. Copy the store id, product id and each variant id into the `lemonSqueezy` fields, then run `npm run check:store-config`.

## Editions and update windows

The shipped editions `standard`, `founding`, `family`, `student` and `nonprofit` (constants in `server/license/constants.js`) are example editions: rename or delete them to fit your products, and keep `pro/config/store.json`, the update windows and the UI labels in step.

- Paid editions are perpetual. Each has an update window: `updatesUntil = purchase date + UPDATE_DAYS[edition]` (`standard` 365 days, `founding` 730, `family` 365).
- `student` and `nonprofit` are yearly: the license ends one year after purchase (or at the store's own expiry if sooner), and `updatesUntil` equals that end.
- Pro is decided by build date, not by the clock: a build is Pro-eligible when its build date is on or before `updatesUntil`. The build date is baked into each artifact (`dist/local-app-studio-build-info.json`, written by `postbuild` through `scripts/license/writeBuildInfo.js`; the sidecar bundler also bakes it in). So a version built inside the window keeps Pro forever, and a later version shows "Pro is off in this version" without touching the data. The release workflow checks that the build wrote a real build date.

## States

`GET /api/license` returns one of these, each with fixed copy from `pro/server/license/entitlements.js`:

| State | Pro | Meaning |
| --- | --- | --- |
| `licensing_off` | yes | No store is configured in `pro/config/store.json` and none was attempted (a malformed filled-in section does not count as off), so nobody could activate a key. Pro is on, `reasons` is `['licensing_off']`, `proSource` is `licensing_off`, `trial.state` is `unavailable` and `trial.notice` is `null`; no trial is ever started. Any stored activation or trial is ignored |
| `free` | no | No license, and the trial has ended (or never started because an activation existed at first launch). Everything free is included |
| `pro` | yes | A valid license within its update window |
| `trial` | yes | The automatic 14-day trial is running (a record written by an earlier 7-day version runs until its own stored end) |
| `update_window_passed` | no | This build was released after `updatesUntil` |
| `expired` | no | A yearly license ended |
| `clock_issue` | no | The clock reads earlier than the last time the app ran; clears once it is right |
| `invalid` | no | The stored record failed its integrity check (`tampered` or `no_key`) |

The status body also carries `edition`, `reasons`, the stored `license` view (store, edition, dates, last four characters of the key, email, `test`, `canDeactivate`), `build`, `trial`, `perks`, the configured `stores`, `purchaseUrl` (the validated `proPurchaseUrl` or `null`) and `supportContact`. `trial` is `{ state, startedAt, endsAt, daysLeft, remindToday, notice }`: `state` is `available` (no record yet), `active`, `ended` or `unavailable` (licensing off), `daysLeft` is whole days rounded up, and `notice` is `'welcome' | 'ending_soon' | 'ended' | null`, the one-time notice that is due. It never carries the key hash, instance id, product id or MAC. Add edition perks in `toStatus` (`perks` is empty by default).

## Activation flow

`activateLicense` in `pro/server/license/index.js` runs these steps in order. Nothing reaches the network before step 6.

1. One activation or deactivation at a time per process (`409 activation_in_progress`).
2. Validate the input, normalize the key and pick the store. Gumroad keys are 4 groups of 8 hex digits (upper-cased); Lemon Squeezy keys are UUIDs (lower-cased). `src/constants/licenseStores.js` mirrors the patterns for the UI.
3. Store not configured in `pro/config/store.json`: `503 store_not_configured`.
4. The local MAC key (`secrets.key`) must be loadable, so a store use is never spent on an activation that cannot be saved (`500 activation_write_failed`).
5. Same key already active: return the current status with no network call.
6. Turn on the `license` network feature (the click is the opt-in) and assert it.
7. Ask the store (below).
8. Compute terms. A yearly license that already ended is refused (`422 license_expired`).
9. Save the record to both local copies, replace the in-memory activation and return the status.

A failure at any step stores nothing and keeps any previous activation.

**Gumroad.** One `POST https://api.gumroad.com/v2/licenses/verify` with the product id, the key and `increment_uses_count=true`. The Pro product is tried first. Only if Gumroad answers 404 for it and a free-license product is configured is that one tried (a 404 spends no use), so a paid key costs one request and a free-license key may cost two. The adapter refuses refunded, charged-back and lost-dispute purchases, test purchases outside a test-allowed build, unknown products or versions, and keys over their `maxUses`. Every successful verify counts one use, including one the app then refuses, which is why the limits carry slack. Gumroad keys are never kept after activation.

**Lemon Squeezy.** One `POST https://api.lemonsqueezy.com/v1/licenses/activate` with the key and the fixed instance name `Local App Studio` (never a hostname or user name). The adapter checks the store, product and variant against your config and refuses test keys outside a test-allowed build. Lemon Squeezy enforces the activation limit itself. "Move to another computer" calls `/v1/licenses/deactivate` with the key and the instance id (the key is kept encrypted in `app_secrets` for that purpose; Gumroad cannot be moved from the app).

Store text is never echoed or logged. Requests use a 10 second timeout, a 64 KiB response cap and no redirects (`storeHttp.js`).

## Local storage and tamper protection

- The activation record is kept on this computer, protected against hand edits. This is deterrence, not DRM.
- The key itself is stored only as a keyed hash plus its last four characters.
- Import never writes license state, and exports leave out the activation record. Assistant never sees license data.
- Rolling the clock back does not extend a yearly license or the trial.

The mechanics are kept with the licensing code (pro, not in the public source).

## Local trial

With licensing on, every data folder gets one 14-day Pro trial (`TRIAL_DAYS` in `server/license/constants.js`), started automatically on first launch and then dropping to Free. There is no start button and no route to start it. No click, no card, no account, no network. A license activated at any time keeps Pro (the license always wins). Data and export are never locked: only Pro actions stop.

**When it starts.** On first launch of a licensing-on build, when this data folder has never had a trial and has no license. A person who already has a license never gets a trial, and removing a license later does not start one. A build with licensing off never starts one. Startup makes no network call.

**What carries over.** A trial that was already running or already over when the app was updated keeps its own end date and is never restarted or extended. A trial record that cannot be verified counts as used. The mechanics are kept with the licensing code (pro, not in the public source).

**Notices (`pro/server/license/trialNotices.js`).** Three one-time, in-app notices: `welcome`, `ending_soon` (at 2 days left or fewer, `TRIAL_REMIND_DAYS_LEFT`) and `ended`. The flags live in the `app_state` row `license.trialNotices` as `{ v: 1, startedAt, welcome, endingSoon, ended }` (`true` means shown and dismissed), on the server and not in the browser, because the desktop window's origin changes each launch. They are cosmetic: not MAC-protected, never read by entitlement code, and best effort (the flags are also kept in memory, so a failed write still stops the notice for this process). A trial started in this process starts with all flags false; a pre-existing trial gets `welcome: true`, `endingSoon: false` and `ended` set to whether it already ended, so an older trial gets no welcome and an already ended one gets no `ended` notice. `trial.notice` in the status comes from the pure `trialNoticeFor` in `entitlements.js`: `null` for a license, licensing off, a `clock_issue`, missing flags or no record; otherwise `welcome` (active, more than 2 days left), `ending_soon` (active, 2 or fewer), `ended` (ended without a clock issue), unless that flag is set. One notice at a time.

**Dismissing.** `dismissTrialNotice(notice)` (`POST /api/license/trial/notice`) sets the flag for the current trial; `ending_soon` also sets `welcome`, `ended` sets all three. With no valid trial (or licensing off) it changes nothing and returns the status. No network.

**Removed route.** `POST /api/license/trial` (the old manual start) now answers `410 { error: 'trial_route_removed', message }` so an old client gets a clear error instead of the generic 404. It starts nothing.

## API

All routes are in `server/licenseRoutes.js`, `no-store`, behind the auth and desktop gates. Errors are `{ error: <code>, message }` (plus `detail` for `license_expired`). Messages are fixed copy in `server/license/messages.js`.

| Route | Purpose |
| --- | --- |
| `GET /api/license` | Status |
| `POST /api/license/activate` | Body `{ licenseKey, store? }` |
| `POST /api/license/deactivate` | Lemon Squeezy only: release this computer. Optional `{ licenseKey }` |
| `DELETE /api/license` | Remove from this computer (no network) |
| `POST /api/license/trial/notice` | Body `{ notice: 'welcome' \| 'ending_soon' \| 'ended' }`: mark a one-time trial notice as shown. Returns the status |
| `POST /api/license/trial` | Removed: answers `410 trial_route_removed` (the trial starts by itself) |

Activate and deactivate share a rate limiter (10 per 15 minutes). Error codes: `400 invalid_request | invalid_key_format`, `409 activation_in_progress | nothing_to_deactivate | deactivate_unsupported | license_key_needed`, `410 trial_route_removed`, `422 key_not_found | license_disabled | license_expired_at_store | license_expired | purchase_refunded | uses_exceeded | activation_limit_reached | unknown_product | test_purchase_not_allowed | key_mismatch`, `429 rate_limited`, `500 activation_write_failed`, `502 store_error`, `503 store_unreachable | store_busy | store_not_configured`.

## Network behavior

The only network use is the activate and deactivate click, through the netPolicy feature `license` (hosts `api.gumroad.com` and `api.lemonsqueezy.com`). Clicking Activate turns that feature on. Startup (including the automatic trial start), status reads, `getEntitlements()` and notice dismissal make no call. The store sees the key, the product id (Gumroad), the instance name (Lemon Squeezy), the user's IP address and a `User-Agent: Local App Studio` header. Nothing about the user's data, device, OS or hostname is sent.

## Settings > License (UI)

`src/components/settings/LicenseSection.jsx` shows a store picker (only configured stores), a key field and an Activate button whose label names the store it will contact. When active it shows the edition, store, dates and last four characters of the key, plus "Move to another computer" (Lemon Squeezy) and "Remove from this computer". While a trial runs it shows "Trial: N days left" ("Trial: 1 day left" on the last day), the end date and the one call to action, "Activate a license"; after it ends it says so and that Pro features are off but everything in Free keeps working. There is no start-trial button. The app shell shows a dismissible banner for each due notice (`TrialNotice`, after onboarding only) and the top bar a "Pro trial: N days left" badge (`TrialBadge`) that links here. When a store is filled in but unusable it shows "This version of Local App Studio can't activate licenses yet."

**Buy button.** With a valid `proPurchaseUrl` in `pro/config/store.json` (`purchaseUrl` in the status), a plain "Buy Local App Studio Pro" link opens that page in the user's default browser (the desktop shell cancels the navigation and opens it externally, `src-tauri/src/nav.rs`). It appears in Settings > License, the ending-soon and ended banners and the Pro prompts, and never when licensing is off or any license is stored on this computer. With the shipped empty value there is no Buy link anywhere. The app makes no request for it.

Steps to activate:

1. Buy the Pro product.
2. Copy the license key from the receipt email.
3. Open the app, then Settings > License.
4. Paste the key and click Activate.

## Test purchases and the Dev channel

Store test purchases (Gumroad `test: true`, Lemon Squeezy `test_mode`) are accepted only when `allowStoreTestPurchases()` (`server/license/channelSeam.js`) is true:

- in the Local App Studio Dev channel (the build whose identifier ends in `.dev`), or
- from a source checkout, outside desktop mode and release builds, with `APP_LICENSE_STORE_TEST=1`.

A record minted from a test purchase is marked `test: true` and never gives Pro in a stable desktop or release build. `APP_LICENSE_STORE_BASE_URL=http://127.0.0.1:<port>` points both adapters at a fake store on loopback, and works only in a source checkout (it is ignored in desktop mode, release builds and a tree without `.git`). `npm run sandbox` passes both variables through when set. Tests never call a real store: they inject a stub `fetchImpl`, an injected clock, and synthetic fixtures.

## Adding a Pro feature

Gate by capability through `server/pro.js` only (a pro build swaps in `pro/server/pro.js`, which has the same names).

1. Add an entry to `PRO_FEATURES` (`{ used: true, label: '...' }`; the placeholder is `{ used: false }`).
2. On a route, mount `requirePro('<id>')` first, before body validation and before `requireAi`, so a free user never reaches a model probe, a queue slot or an SSE header. It answers `403 { error: 'pro_required', feature, message }`. In library code call `assertPro('<id>')`.
3. In the UI, use `useEntitlements()` with `ProGateNotice` and `ProTrialPrompt`.
4. Code computes every figure, the model only words it, one audit row per call.

Never gate data, export, import, backups or privacy controls. `isAiEnabled()` is the on and off seam for the model and is not a license check.

## What will be open and what stays pro

The code is split by license, and the repository is laid out for it:

- **Open core: AGPL-3.0.** The Studio, the server skeleton, the data layer, the Tauri shell, the checks, the docs and the e2e suite. The root `LICENSE` is the GNU AGPL-3.0 text (`package.json` says `AGPL-3.0-only`).
- **Runtime slice: MIT, in `packages/runtime/`.** The app spec, the theme engine, the part catalog components, the renderer and the runtime server routes that ship inside every built app (`packages/runtime/LICENSE`, [ARCHITECTURE.md](ARCHITECTURE.md), "The runtime package").
- **Pro: FSL-1.1-MIT, in `pro/`.** The helper (prompts, pipeline, part lists, eval set), the Make installer and release automation, licensing and the Pro gate, and the cloud provider (`pro/LICENSE`, `pro/README.md` (pro, not in the public source)). Each pro module that open code imports has a public stub at its original path, so a build without `pro/` (or with `APP_PRO_DIR=none`) still works with those parts absent ([ARCHITECTURE.md](ARCHITECTURE.md), "The pro seam").

The public source is made by an export that leaves out `pro/` and starts a fresh history. One decision is open: a built app carries pro files (the licensing twins and the cloud provider) and the MIT slice imports AGPL code, so which license a built app has as a whole is not settled.

## Residual risks

Refunds and chargebacks are caught only at activation time, because the app never re-checks (the no-network promise). A refused or timed-out activation may still use one store activation, which is why limits carry slack and the seller can reset. A user who deletes both local copies of the trial (or wipes the data folder) gets a fresh 14-day trial on the next launch, and so does a user who removes a license from a folder that never had a trial record (the check runs once per launch, so the second case needs a restart). A determined user who patches the code is out of scope.
