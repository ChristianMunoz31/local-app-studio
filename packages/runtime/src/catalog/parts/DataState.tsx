import { formErrorClass } from '../../../../../src/components/shared/formStyles.js';
import { Skeleton } from './kit.ts';

/** Loading placeholder for a data part: skeleton lines, announced as "Loading". */
export function LoadingLines() {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className={formErrorClass}>
      {message}
    </p>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return <p className="text-sm text-slate-slate400">{text}</p>;
}

export function Notice({ text }: { text: string | null }) {
  return text ? (
    <p role="status" className="text-xs text-slate-slate400">
      {text}
    </p>
  ) : null;
}
