import { Suspense } from 'react';
import RouteBoundary from '../shared/RouteBoundary.jsx';
import SectionCard from '../shared/SectionCard';
import { SETTINGS_SECTIONS, sectionProps } from './settingsSections';

// A kit Settings section loaded on demand (a lazy chunk). While it loads, the same card shows with the section's own anchor and
// heading ids, so the nav links, the scroll spy and a #deep-link have their target at once and the heading is where it will stay;
// the loading line is a status message for screen readers. A chunk that fails to load shows the section error card
// (RouteBoundary), not a blank gap. The section itself keeps its imports: the cloud seam (cloudUi.js) is reached through it only.
export default function LazySection({ id, children }) {
  const { label, icon } = SETTINGS_SECTIONS.find((s) => s.id === id);
  return (
    <RouteBoundary variant="section">
      <Suspense
        fallback={
          <SectionCard {...sectionProps(id)} title={label} icon={icon}>
            <p role="status" className="text-sm text-slate-slate400">
              Loading this section.
            </p>
          </SectionCard>
        }
      >
        {children}
      </Suspense>
    </RouteBoundary>
  );
}
