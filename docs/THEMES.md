# Themes

A theme is the look of a built app: its colors, the glow behind the page, the corner size, the fonts and the spacing. A spec names one of eight built-in themes (`theme.id`) and may change three things about it (`theme.overrides`). Themes are constants in the code: a spec never carries a color, a size or a font, only a choice from a short list. The engine is `packages/runtime/src/theme/`, the Studio pieces are `src/studio/theme/`. The schema block is in [APP_SPEC.md](APP_SPEC.md).

## What a spec may say

```json
{ "preset": "forest", "radius": "md", "id": "forest", "overrides": { "accentHue": 140, "radius": "lg", "mode": "dark" } }
```

| Key | Values | Meaning |
| --- | --- | --- |
| `id` | `slate`, `paper`, `midnight`, `forest`, `sand`, `ocean`, `rose`, `mono` | The theme. Without it the app keeps the standard kit look ("Classic"). |
| `overrides.accentHue` | whole number 0 to 359 | The accent color as a hue angle. Any hue is safe: the engine picks the lightness that keeps text readable. |
| `overrides.radius` | `none`, `sm`, `md`, `lg` | Corner size instead of the theme's own. |
| `overrides.mode` | `light`, `dark` | The mode a fresh install of the built app starts in. |
| `preset`, `radius` | the old keys | The legacy background glow and corners. Used only without an `id`. When Studio picks a theme it writes both from the theme data, so older readers get a close look. |

`overrides` need an `id` (the schema refuses them otherwise). Nothing else is accepted; unknown keys are refused.

## The eight themes

| id | Label | Feel | Starts in | Corners | Heading font |
| --- | --- | --- | --- | --- | --- |
| slate | Slate | Calm and warm | light | medium | Inter |
| paper | Paper | Light and bookish | light | small | serif |
| midnight | Midnight | Deep blue and dark | dark | round | Inter |
| forest | Forest | Green and natural | dark | medium | system |
| sand | Sand | Warm and friendly | light | round | serif |
| ocean | Ocean | Fresh and blue | light | medium | system |
| rose | Rose | Soft and pink | light | round | Inter |
| mono | Mono | Plain gray | light | square | mono |

Every theme works in light and dark. Status colors (green, red, amber and the rest) never change with the theme: a green stays a green. The accent (links, tabs, focus ring, the brand fill) comes from the accent hue.

Classic is not a theme you can pick: it is what a spec without an `id` shows, so every app made before themes looks the same as before. New apps start on the plain look, a blank pearl-white sheet: Classic with the `solid` background (`{ "preset": "solid", "radius": "md" }`, no `id`). A blank app is saved that way right after it is created, and Describe gives a new app the plain look when the model proposes no valid theme. The picker lists it first as "Plain" ("White and simple"). It paints no glow: a Studio scope (Design, Preview) sets the kit light palette, the pearl page and no `--mesh-*` variable (`packages/runtime/src/theme/plain.ts`), and a built app sets the pearl page in light mode and uses `solid` as the default background. The plain look in dark (Show as Dark, or a built app in dark) is a flat dark page, never a gradient or a glow. The light page is a flat pearly white, `PEARL_PAGE` (`rgb(251, 249, 246)`) in `packages/runtime/src/theme/themes.ts`, returned by `plainPage('light')`; cards and inputs stay white, so they lift off the page. The dark page still comes from the Slate tone data. Named themes (Paper included) keep their own palettes. The theme tests also check the contrast of text, status colors and the input border on the pearl page. Existing apps keep their theme (or Classic). In a built app Classic behaves as before themes existed (Settings keeps Light, Dark and System and the background pickers, and a saved choice wins), except that it starts light instead of following the computer, and the baked `preset` is the default background until the user picks one and the baked `radius` sets the corners.

## How it is applied

- **Studio** wraps the area it shows in `ThemeScope` (the Preview step, the swatches, and the Look tab of Design, which Change look on the Apps page opens). The scope sets the variables on its own element's inline style, so Studio's own chrome keeps the kit theme. A kit dialog opened from inside a previewed app portals to the page body, so the Preview step hands it the look: `PortalScopeContext` (`src/components/shared/portalScope.js`) carries the scope's variables, color scheme, color and font, and `Modal` spreads them on its overlay (never the page background). Studio's own dialogs, on the canvas included, have no such context and show Studio's look.
- **A built app** calls `startRuntimeTheme` (`packages/runtime/src/theme/applyRoot.ts`) before React mounts. It sanitizes the baked theme block, sets the variables on `<html>` with `style.setProperty`, and sets them again when the `light` class changes or an accessibility setting changes. For a spec with an `id`, the app starts in `overrides.mode`, else the theme's own mode (Midnight and Forest start dark, the others light); a Classic app starts light. Studio itself follows the computer. Settings offers Light and Dark only, names the theme ("This app uses the Forest theme.") and has no background pickers. A choice the user makes in Settings wins from then on. Settings is reached from the Settings button at the end of the menu bar (or in the corner when the app has no bar). The page background (`#bg-layer`, the theme's mesh) is the same one Preview paints; a Classic app keeps Light, Dark, System and the background pickers.
- **Accessibility.** With no backdrop blur, reduced transparency or increased contrast, the engine emits the same solid surfaces, strong borders and empty glow the kit's media rules emit (inline values would otherwise beat those rules).

Nothing is added to a stylesheet and no `<style>` text is written: the desktop CSP allows inline style properties only.

## The variable contract

`packages/runtime/src/theme/variables.ts` lists every custom property a theme may set (`THEME_VARIABLES`): the slate scale, page background and text, the brand and accent set, the status accents, the glass and surface tokens, focus ring, the three glow colors, the five corner sizes, `--spacing` and the two font variables. A spec without an `id` resolves `LEGACY_VARIABLES` (the glow and the corners); a built app applies only the corners from them and uses `preset` as the default background setting. Nothing outside the list is ever written.

Parts read these variables through the kit classes (`slate-slateNNN`, `accent-*`, `slate-brand*`, the `glass` classes) and nothing else. `src/catalog/__tests__/themeAudit.test.ts` reads every part file and the kit style files they import, maps the classes to the variables they use, and fails on a variable outside the list or a fixed color (`#hex`, `rgb(`, a palette name, `white`, `black`) that is not on its short allowlist with a reason. The one entry today is `text-white` on the primary button, which is safe because the engine solves the brand color for at least 4.5:1 against white. The same rule covers the Studio screens: `src/studio/__tests__/themeAudit.test.ts` reads every `.ts`, `.tsx` and `.jsx` file under `src/studio` outside `__tests__` and fails on a fixed color in a string, a palette, `white` or `black` color class, or `text-white` away from `bg-slate-brand`. Its allowlist is empty.

### Known limits

- **Corners.** None. `rounded-sm|md|lg` read `--radius-sm|md|lg` and `rounded-xl|2xl` read `--radius-xl|2xl` (`tailwind.config.cjs` no longer pins them). The `:root` defaults in `src/index.css` are the kit's own values, so Studio looks the same; a theme scope or a built app changes all five.
- **Fonts.** `font-sans` and `font-display` are fixed stacks in the same config, so the theme font reaches the page through the inherited `font-family` (set on the scope or on `<body>`) and headings through `font-[family-name:var(--font-display)]`.
- **Spacing.** `--spacing` is read by the spacing utilities, so density works everywhere.

## Adding a theme

1. Add the id to `THEME_IDS` in `packages/runtime/src/theme/ids.ts`.
2. Add a `ThemeDef` to `THEMES` in `packages/runtime/src/theme/themes.ts` (tone, accent hue and chroma, background, corners, font, density, starting mode). A new tone goes in `TONES`: keep the kit step luminances so the contrast rules hold.
3. Run `npx vitest run packages/runtime/src/theme packages/runtime/src/spec`. The tests resolve every variable for every theme, mode, environment and accent hue (step 15) and check text contrast, white on the brand fill, status colors on the surfaces, the input border and the glass text pairs.
4. Add the label to the Describe prompt line in `pro/server/studio/describe/prompts.js` if the model should be able to propose it.

## Security

- Only schema enums and whole numbers 0 to 359 reach a CSS value. `sanitizeTheme` re-checks the theme block at the runtime boundary (a built app has no zod) and never throws; inherited keys and prototype keys are ignored.
- Variable names come from `THEME_VARIABLES`; values are built in code from constants and clamped integers. A test checks every value of every theme, mode and environment against its pattern and against `;{}<>"`, `url(`, `expression`, `@import` and comments.
- Values are applied through the `style` property (React `style` or `style.setProperty`), never as stylesheet text.
- The runtime build carries only the small files under `packages/runtime/src/theme/`. No Studio, catalog, spec or zod code is in that graph.

## Describe

The tables step may propose a theme (`"theme": "forest"`). It is applied in create mode, and in edit mode only when the app has no `id` yet; an unknown value is dropped and never causes a repair round. In create mode, when the base has no `id` and the model proposes no valid theme, the app gets the plain look (no `id`, `solid` background); an edit of a Classic app keeps Classic. The prompt line asks the model to leave the theme out unless the description asks for a look, and to prefer light. The proposal is applied with `withThemeId`, so `preset` and `radius` are written from the theme data together with the `id`, as when a theme is picked in Studio. The review shows `Look: Forest.` when the look changes.
