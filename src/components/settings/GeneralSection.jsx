import { SlidersHorizontal } from 'lucide-react';
import SectionCard from '../shared/SectionCard';
import { sectionProps } from './settingsSections';
import SegmentedRadio from './SegmentedRadio';
import ResetControl from './ResetControl';
import DisplayNameField from './DisplayNameField';
import ProviderSelector from './ProviderSelector';
import { Link } from 'react-router-dom';

const ON_OFF_OPTIONS = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
];

export default function GeneralSection({
  advisorButton = true,
  onAdvisorButtonChange,
  autoAdvise = true,
  onAutoAdviseChange,
  onReset,
}) {
  return (
    <SectionCard
      {...sectionProps('general')}
      title="General"
      subtitle="Profile and Assistant."
      icon={SlidersHorizontal}
    >
      <div className="space-y-6">
        <DisplayNameField />
        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-slate100">Assistant&apos;s AI model</p>
          <ProviderSelector />
          <p className="mt-1.5 text-xs text-slate-slate400">
            Models are chosen in{' '}
            <Link
              to={{ pathname: '/settings', hash: '#ai' }}
              className="font-medium underline underline-offset-2 hover:text-slate-slate100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
            >
              Settings &gt; AI
            </Link>
            . Not changed by Reset.
          </p>
        </div>
        <SegmentedRadio
          legend="Show the Assistant button (you can still open Assistant from search)"
          name="settings-assistant-advisor"
          value={advisorButton}
          onChange={onAdvisorButtonChange}
          options={ON_OFF_OPTIONS}
          hint="Shows the round Assistant button in the bottom-right corner. Turning it off only hides the button."
        />
        <SegmentedRadio
          legend="Auto-advise when opened"
          name="settings-assistant-auto"
          value={autoAdvise}
          onChange={onAutoAdviseChange}
          options={ON_OFF_OPTIONS}
          hint="Assistant reviews the page as soon as you open the panel. Each review counts toward Assistant's limit of 20 requests every 15 minutes, shared with your questions."
        />
      </div>
      <div className="mt-5 flex justify-end border-t border-white/10 pt-4">
        <ResetControl label="General" onConfirm={onReset} />
      </div>
    </SectionCard>
  );
}
