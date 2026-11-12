// Asks which app to add an entry to, then opens that app's Design step with the entry chosen.
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Modal from '@/components/shared/Modal.jsx';
import { ListSkeleton } from '@/components/shared/Skeleton.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { useApps } from '../hooks/useApps';
import { STEP_FOCUS, stepPath } from '../lib/steps';
import { HINT_CLASS } from '../components/ui';
import type { ShowcaseEntry } from './entries';

export interface UseInAppDialogProps {
  entry: ShowcaseEntry;
  onClose(): void;
}

export default function UseInAppDialog({ entry, onClose }: UseInAppDialogProps) {
  const { apps, loading, error } = useApps();
  const navigate = useNavigate();
  const selectId = useId();
  const [chosen, setChosen] = useState('');
  const usable = apps.filter((a) => a.ok);
  const appId = usable.some((a) => a.id === chosen) ? chosen : (usable[0]?.id ?? '');

  return (
    <Modal title={`Use "${entry.name}" in an app`} onClose={onClose}>
      {loading ? (
        <ListSkeleton rows={2} />
      ) : error ? (
        <p role="alert" className={formErrorClass}>
          {error}
        </p>
      ) : usable.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-slate300">Make an app first on the Apps page.</p>
          <Link to="/apps" className={`${btnSecondary} inline-block`} onClick={onClose}>
            Go to Apps
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (appId !== '') navigate(stepPath(appId, 'design'), { state: { ...STEP_FOCUS, addEntry: entry.key } });
          }}
        >
          <div>
            <label htmlFor={selectId} className={labelClass}>
              App
            </label>
            <select id={selectId} className={inputClass} value={appId} onChange={(e) => setChosen(e.target.value)}>
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <p className={HINT_CLASS}>Design opens with this ready to add to a page.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary}>
              Open Design
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
