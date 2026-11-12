// Playwright reporter: prints one preview-start line per run, "[preview-start] count=N timeouts=T p95=X.Xs max=Y.Ys (the harness waits 30 s)".
// e2e/pages/preview.js records the seconds from the click that starts a Preview child to "Your app is running." as a `preview-start`
// annotation of the test. A load timeout in a run is judged against this line: a p95 near the 30 s wait means the machine is
// overloaded (a scheduling defect, docs/PIPELINE.md), a p95 of 10 s or less means the timeout is something else. A start that hit the
// 30 s wait has no seconds to record: e2e/pages/preview.js records a `preview-start-timeout` annotation instead and `timeouts=T` counts them.
// Annotations are read from each attempt's result, so a retried test counts every attempt once and never twice.
export const PREVIEW_START = 'preview-start';
export const PREVIEW_START_TIMEOUT = 'preview-start-timeout';

/** The nearest-rank percentile of a list of numbers (0 for an empty list). */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** The line for a list of start seconds and the number of starts that timed out (null when there is neither). */
export function previewStartLine(seconds, waitSeconds = 30, timeouts = 0) {
  if (seconds.length === 0 && timeouts === 0) return null;
  return `[preview-start] count=${seconds.length} timeouts=${timeouts} p95=${percentile(seconds, 95).toFixed(1)}s max=${(seconds.length === 0 ? 0 : Math.max(...seconds)).toFixed(1)}s (the harness waits ${waitSeconds} s)`;
}

export default class PreviewStartReporter {
  constructor() {
    this.seconds = [];
    this.timeouts = 0;
  }

  printsToStdio() {
    return false;
  }

  /** Called once per attempt: `result.annotations` belong to that attempt alone (`test.annotations` can carry an earlier attempt's). */
  onTestEnd(test, result) {
    for (const a of result?.annotations ?? test.annotations) {
      const n = Number(a.description);
      if (a.type === PREVIEW_START && Number.isFinite(n)) this.seconds.push(n);
      else if (a.type === PREVIEW_START_TIMEOUT) this.timeouts += 1;
    }
  }

  onEnd() {
    const line = previewStartLine(this.seconds, 30, this.timeouts);
    if (line) console.log(line);
  }
}
