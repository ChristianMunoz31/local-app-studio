import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// `import { z } from 'zod'` (or `export { z } from 'zod'`) keeps z.locales (about 264 KiB) in the sidecar bundle.
const ZOD_NAMED_Z_MESSAGE = "Use import * as z from 'zod'. The named z import keeps z.locales (about 264 KiB) in the sidecar bundle (docs/BUDGETS.md).";
const ZOD_NAMED_Z = [
  { selector: "ImportDeclaration[source.value='zod'][importKind!='type'] > ImportSpecifier[imported.name='z'][importKind!='type']", message: ZOD_NAMED_Z_MESSAGE },
  { selector: "ExportNamedDeclaration[source.value='zod'] > ExportSpecifier[local.name='z']", message: ZOD_NAMED_Z_MESSAGE },
];

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '.sidecar-build', 'src-tauri']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { 'no-restricted-syntax': ['error', ...ZOD_NAMED_Z] },
  },
  // TypeScript (the catalog, the Studio UI, the spec layer, and the vendored ui-builder code with its tests): strict typescript-eslint rules.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
    rules: { 'no-restricted-syntax': ['error', ...ZOD_NAMED_Z] },
  },
  // Vendored third-party code (src/vendor/**): lint-clean, but upstream style rules that it violates are off.
  // Do not "fix" vendored files to satisfy these; see src/vendor/ui-builder/README.md.
  {
    files: ['src/vendor/**/*.{ts,tsx}'],
    // Upstream eslint-disable comments target rules that are already off here.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/error-boundaries': 'off',
      'no-empty': 'off',
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
    },
  },
  // Node-side files (API server, SQLite layer, scripts, tooling)
  {
    files: [
      'server.js',
      'devServer.js',
      'loadEnv.js',
      'server/**/*.js',
      'scripts/**/*.js',
      'pro/server/**/*.js',
      'pro/scripts/**/*.js',
      'packages/runtime/server/**/*.js',
      '*.config.{js,cjs}',
    ],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
  },
  // Node ESM scripts written as .mjs (init-app, package-kit); pro/ (docs/ARCHITECTURE.md, 'The pro seam') is linted like the rest
  {
    files: ['scripts/**/*.mjs', 'pro/scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
    rules: { 'no-restricted-syntax': ['error', ...ZOD_NAMED_Z] },
  },
  // Playwright e2e (runs in Node; a few helpers pass callbacks that execute in the browser page)
  {
    files: ['e2e/**/*.{js,mjs}', 'playwright*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      sourceType: 'module',
    },
    // Not React code: Playwright's fixture callback is literally named `use`, and helpers such as
    // `useApp` register test hooks at file top level.
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
])
