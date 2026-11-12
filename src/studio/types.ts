// Shapes of the Studio server (docs: local-app-studio-workspace/DESIGN-phase3.md sections 3, 7.3, 7.4). Types only.
import type { FeatureBinding, FeatureParam } from '@/catalog/features';
import type { AppSpec, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema';

export interface AppSummary {
  id: string;
  name: string;
  slug: string;
  revision: number;
  ok: boolean;
  issueCount: number;
  tableCount: number;
  pageCount: number;
  description: string;
  hasInstaller: boolean;
  /** The helper's design that waits for this app (counts of its tables and pages), or null. */
  waiting: { tableCount: number; pageCount: number } | null;
  /** True when the app was made from an example and keeps its sample records (they seed Preview). */
  sample?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppRecord {
  id: string;
  name: string;
  slug: string;
  revision: number;
  /** Null when the stored design fails the checks; `issues` and (when small enough) `raw` say why. */
  spec: AppSpec | null;
  issues: SpecIssue[];
  raw?: unknown;
  /** The words of the first prompt, kept by Use this for a window whose browser storage has none. */
  firstPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

/** What happened to the Preview's records at the last start. */
export interface PreviewData {
  kept: boolean;
  reason: 'first_start' | 'unchanged' | 'tables_updated' | 'tables_replaced' | 'repaired' | 'reset';
  /** How many sample records were added at this start, when the app has a sample. */
  seeded?: number;
}

export interface PreviewStatus {
  state: 'stopped' | 'starting' | 'running' | 'failed';
  appId: string | null;
  revision: number | null;
  startedAt: string | null;
  message: string | null;
  data: PreviewData | null;
}

export type SaveResult =
  | { ok: true; record: AppRecord }
  | { ok: false; code: 'invalid_spec' | 'revision_conflict' | 'slug_taken' | 'error'; message: string; issues: SpecIssue[] };

export interface WorkspaceValue {
  /** Spec is non-null inside the tabs (the broken view replaces the tabs). */
  record: AppRecord;
  spec: AppSpec;
  revision: number;
  /**
   * Saves `next` as built from `baseRevision` (the revision of the spec the caller made it from). Saves run one at a time; a
   * save whose base is no longer the server's revision gets a conflict, never an overwrite.
   */
  save(next: AppSpec, opts: { baseRevision: number; clearWaiting?: boolean; waitingAt?: string | null }): Promise<SaveResult>;
  reload(): Promise<void>;
  setDirty(tab: 'data' | 'design', dirty: boolean): void;
}

/** The helper's run kept with the app on the server (GET /api/studio/apps/:id/waiting). `proposal` is null when only the words are left. */
export interface WaitingEntry {
  mode: 'create' | 'edit';
  instruction: string;
  /** The asks made on the waiting design, newest last. */
  asks: string[];
  proposal: AppSpec | null;
  /** The waiting design the newest ask replaced. */
  replaced: AppSpec | null;
  fallbacks: DescribeFallback[];
  baseRevision: number | null;
  at: string | null;
}

export interface DescribeFallback {
  part: string;
  pageId?: string;
  message: string;
}

export interface DescribeProgress {
  step: string;
  status: 'running' | 'done' | 'failed';
  message: string;
  pageId?: string;
}

export type DescribeEvent =
  | { type: 'meta'; ai: { kind: string; host: string | null } }
  | ({ type: 'progress' } & DescribeProgress)
  | { type: 'proposal'; proposal: AppSpec; fallbacks: DescribeFallback[]; baseRevision: number; steps: number; onto?: 'waiting' | null; replaced?: AppSpec | null; at?: string | null }
  | { type: 'error'; code: string; message: string; retryMs?: number }
  | { type: 'done' };

/** Shown when a save is refused because the app changed elsewhere. */
export const CONFLICT_MESSAGE =
  'This app changed in another window, so your change was not saved. The newer version is already loaded behind your edits, and your edits stay here until you leave. To keep both, note your change and make it again.';

/** The start of the server's answer when the app was deleted (for example in another window). */
export const APP_GONE_START = 'That app does not exist';

// Features (docs/FEATURES.md, DESIGN-phase6.md section 7). Shapes of server/studio/features/routes.js.
export interface FeatureInput {
  id: string;
  label: string;
  description: string;
  params: FeatureParam[];
  fragment: LayoutLayer;
  bindings: FeatureBinding[];
}

export interface FeatureUsage {
  apps: { id: string; name: string }[];
  features: { id: string; label: string }[];
}

export interface FeatureRecord {
  id: string;
  label: string;
  description: string;
  version: number;
  updatedAt: string;
  createdAt: string;
  params: FeatureParam[];
  /** Null when the stored feature fails the checks (`ok` is false and `issues` says why). */
  fragment: LayoutLayer | null;
  bindings: FeatureBinding[];
  ok: boolean;
  issues: SpecIssue[];
  usedBy: FeatureUsage;
}

export interface FeatureImportResult {
  imported: FeatureRecord[];
  renamed: { from: string; to: string }[];
}

export const FEATURE_FILE_FORMAT = 'local-app-studio-feature';

/** One exported feature plus the features it uses (dependencies first). */
export interface FeatureFile {
  format: typeof FEATURE_FILE_FORMAT;
  formatVersion: 1;
  feature: FeatureInput;
  includes: FeatureInput[];
}
