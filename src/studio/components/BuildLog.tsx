// Live build log: a monospace log region that follows new lines while the reader stays near the bottom.
import { useLayoutEffect, useRef } from 'react';
import type { BuildLogLine } from '../buildTypes';

export const LOG_LINE_CAP = 2000;
const STICK_PX = 40;

export default function BuildLog({ lines, truncated }: { lines: BuildLogLine[]; truncated: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const stuck = useRef(true);
  const shown = lines.length > LOG_LINE_CAP ? lines.slice(lines.length - LOG_LINE_CAP) : lines;
  const capped = truncated || lines.length > LOG_LINE_CAP;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = (): void => {
    const el = ref.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  };

  return (
    <div>
      {capped && <p className="mb-1 text-xs text-slate-slate400">Showing the last {LOG_LINE_CAP} lines</p>}
      <pre
        ref={ref}
        role="log"
        aria-label="Build log"
        aria-live="off"
        tabIndex={0}
        onScroll={onScroll}
        className="max-h-80 overflow-auto rounded-md glass-input p-3 font-mono text-xs leading-relaxed text-slate-slate300 whitespace-pre-wrap break-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
      >
        {shown.map((l) => l.line).join('\n')}
      </pre>
    </div>
  );
}
