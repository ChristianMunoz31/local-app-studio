# Vendored ui-builder

Source copied from https://github.com/olliethedev/ui-builder (MIT), package `ui-builder` 1.0.0, upstream commit
`fb42d61d026e83c62e619d06731d907e686c045f`. The license text is in `THIRD_PARTY_NOTICES.md` at the repo root.

Upstream paths are mirrored under this folder, so `components/ui/ui-builder/index.tsx` here is upstream's
`components/ui/ui-builder/index.tsx`. Treat the tree as read-only third-party code: keep local changes small and
list each one below.

## What was copied

- `components/ui/ui-builder/**` (editor `index.tsx`, `layer-renderer.tsx`, `types.ts`, `internal/**`,
  `components/{flexbox,grid,icon}.tsx`)
- `components/ui/auto-form/**`
- shadcn primitives in `components/ui/*.tsx` that the editor and auto-form import (accordion, badge, button,
  calendar, card, checkbox, command, date-picker, dialog, dropdown-menu, form, input, label, popover, radio-group,
  resizable, select, separator, sonner, switch, tabs, textarea, toggle, tooltip)
- `lib/ui-builder/**` (stores, DnD context, hooks, shortcuts, utils, registry)
- `lib/utils.ts`
- `hooks/{use-debounce,use-keyboard-shortcuts,use-store}`

## What was dropped

- Server rendering: `server-layer-renderer.tsx`.
- Tiptap / minimal-tiptap, charts (recharts, `chart.tsx`, `chart-demos.tsx`), carousel (embla), the docs app (`app/`),
  registry build scripts, react-scan, Next.js, next-themes.
- Markdown and code display: `components/ui-builder/components/{markdown,codeblock,code-panel}.tsx` (react-markdown,
  syntax highlighter).
- Registry files `lib/ui-builder/registry/shadcn-component-definitions.ts` (4000 lines, needs charts, carousel and
  most primitives) and `block-definitions.ts`. Nothing in the editor imports them. Kept:
  `primitive-component-definitions.ts`, `complex-component-definitions.ts`, `custom-component-definitions.ts`,
  `form-field-overrides.tsx`.

## Local changes

1. Import rewrite: `@/components/` -> `@/vendor/ui-builder/components/`, `@/lib/` -> `@/vendor/ui-builder/lib/`,
   `@/hooks/` -> `@/vendor/ui-builder/hooks/`. `@/` maps to `src/` (`vite.config.js`, `vitest.config.js`,
   `tsconfig.json`).
2. next-themes replaced by the kit `useTheme()` from `src/contexts/ThemeContext.jsx`:
   - `ui-builder/index.tsx`: the `ThemeProvider` wrapper is removed (the kit's ThemeProvider is app-level).
   - `internal/components/nav.tsx`: `ModeToggle` kept; it calls `setTheme('light' | 'dark' | 'system')`, which the kit
     context accepts.
   - `components/ui/sonner.tsx`: uses the kit `theme`.
3. `nav.tsx`: the `CodePanel` is removed, and `NavBar` now forces `showExport = false`, so the "Export Code" button, the
   export menu item and the "Generated Code" dialog never render (this product never shows generated code). The
   `showExport` prop stays in `NavBarProps` and is ignored.
4. `custom-component-definitions.ts`: `CodePanel` and `Markdown` registry entries removed (and their imports).
   `layer-utils.ts` (store migration): the `textType === "markdown"` branch no longer maps to the unregistered `Markdown`
   layer type; every migrated text layer becomes a plain `span`.
5. `form-field-overrides.tsx`: `childrenAsTipTapFieldOverrides` and the `MinimalTiptapEditor` import removed.
6. Em dashes in comments replaced with commas or hyphens (repo `check:em-dash`).
7. lucide-react: upstream used 0.441, the kit uses ^1. Every named icon import was checked against the installed package and none needed renaming.
8. Styling: no class was rewritten. The app runs Tailwind 4 (`src/index.css`): shadcn tokens (`bg-background`, `border-input`, ...)
   map onto the kit palette, `dark:` means "not `:root.light`", animations come from `tw-animate-css`, and `src/vendor/**`
   is scanned through `@source`. `components/ui/ui-builder/internal/utils/tailwind-classes.ts` (the class picker's list of
   every Tailwind class) is excluded from the scan, because compiling all of it adds about 110 kB of CSS.
9. zod imports: `import { z } from "zod"` rewritten to `import * as z from "zod"` in every vendored file. The named form keeps
   `z.locales` (about 264 KiB) out of tree shaking; ESLint now rejects it repo wide.
10. `store/layer-store.ts`: `skipHydration: true` on the zustand `persist` options. Upstream hydrates from the raw
    `localStorage` `layer-store` entry at module evaluation, whatever the `persistLayerStoreConfig` flag says (it defaults
    on). Studio never persists the layer store, so nothing is read; the store starts from its initial state.

Lint: `eslint.config.js` has a relaxed block for `src/vendor/**` (any, unused vars, react-refresh and the React
Compiler hook rules off). Do not rewrite vendored code to satisfy stricter rules.

## Re-sync procedure

1. Check out the new upstream commit next to this repo (read only).
2. Copy the same paths listed under "What was copied" over this tree, skipping the dropped files.
3. Re-apply the import rewrite with sed over the new files, then re-apply local changes 2 to 10 above.
4. Compare the new upstream imports against `package.json` and add any new packages.
5. Update the commit hash here and in `THIRD_PARTY_NOTICES.md`, then run `npm run lint`, `npm test`, `npm run check`.
