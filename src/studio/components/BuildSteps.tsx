// The nine build steps with a status each. The current step is announced politely to screen readers.
import { Check, Circle, Loader2, Minus, X } from 'lucide-react';
import type { BuildStepState, StepStatus } from '../buildTypes';

const STATUS_TEXT: Readonly<Record<StepStatus, string>> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <Check size={14} className="text-accent-green" aria-hidden="true" />;
    case 'running':
      return <Loader2 size={14} className="animate-spin text-slate-brandLight" aria-hidden="true" />;
    case 'failed':
    case 'cancelled':
      return <X size={14} className="text-accent-red" aria-hidden="true" />;
    case 'skipped':
      return <Minus size={14} className="text-slate-slate500" aria-hidden="true" />;
    default:
      return <Circle size={14} className="text-slate-slate500" aria-hidden="true" />;
  }
}

export default function BuildSteps({ steps }: { steps: BuildStepState[] }) {
  const current = steps.find((s) => s.status === 'running');
  return (
    <div>
      <p className="sr-only" aria-live="polite" role="status">
        {current ? `Current step: ${current.label}` : ''}
      </p>
      <ol className="space-y-1.5" aria-label="Build steps">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm text-slate-slate300">
            <StatusIcon status={step.status} />
            <span className={step.status === 'running' ? 'font-semibold text-slate-slate100' : ''}>{step.label}</span>
            <span className="text-xs text-slate-slate500">{STATUS_TEXT[step.status]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
