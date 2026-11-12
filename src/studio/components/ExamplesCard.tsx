// The Examples card on the Apps page: eight ready-made apps to open, try with sample records and change.
import { useId } from 'react';
import { Lightbulb } from 'lucide-react';
import StudioSectionCard from '@/studio/components/StudioSectionCard';
import type { ExampleId, ExampleMeta } from '@/studio/examples';
import { EXAMPLES_SUBTITLE, EXAMPLES_TITLE } from '../lib/examples';
import ExampleCard from './ExampleCard';

export interface ExamplesCardProps {
  examples: readonly ExampleMeta[];
  /** The example being made, or null. */
  busyId: ExampleId | null;
  onUse(meta: ExampleMeta): void;
  buttonRef?(id: ExampleId, el: HTMLButtonElement | null): void;
}

export default function ExamplesCard({ examples, busyId, onUse, buttonRef }: ExamplesCardProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <StudioSectionCard title={EXAMPLES_TITLE} headingId={headingId} icon={Lightbulb} subtitle={EXAMPLES_SUBTITLE}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {examples.map((meta) => (
            <ExampleCard key={meta.id} meta={meta} busy={busyId !== null} pressed={busyId === meta.id} onUse={onUse} buttonRef={buttonRef} />
          ))}
        </ul>
      </StudioSectionCard>
    </section>
  );
}
