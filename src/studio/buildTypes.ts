// Shapes of the build pipeline (DESIGN-phase4.md sections 3, 6 and 9). Types and display tables only.

export type BuildStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type StepId = 'toolchain' | 'extract' | 'npm-ci' | 'init-app' | 'write-spec' | 'desktop-build' | 'locate-installer' | 'copy' | 'record';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';

export interface BuildRecord {
  id: string;
  appId: string;
  status: BuildStatus;
  specRevision: number | null;
  appVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  installerPath: string | null;
  installerSha256: string | null;
  installerSizeBytes: number | null;
  errorCode: string | null;
  message: string | null;
}

export interface BuildStepState {
  id: StepId;
  label: string;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BuildLogLine {
  seq: number;
  step: StepId;
  line: string;
}

export interface BuildSnapshot {
  build: BuildRecord;
  steps: BuildStepState[];
  lines: BuildLogLine[];
  truncated: boolean;
  live: boolean;
}

export type BuildEvent =
  | ({ type: 'snapshot' } & BuildSnapshot)
  | { type: 'step'; step: StepId; status: StepStatus; at: string }
  | ({ type: 'log' } & BuildLogLine)
  | { type: 'end'; build: BuildRecord };

export interface ToolchainItem {
  id: 'node' | 'npm' | 'rustc' | 'cargo' | 'msvc' | 'winsdk' | 'webview2';
  label: string;
  status: 'found' | 'missing';
  required: boolean;
  path: string | null;
  version?: string;
  /** Empty when the tool is found. */
  hint: string;
}

export interface ToolchainReport {
  ok: boolean;
  checkedAt: string;
  hostTriple: string | null;
  items: ToolchainItem[];
}

export const BUILD_STATUS_LABEL: Readonly<Record<BuildStatus, string>> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};
