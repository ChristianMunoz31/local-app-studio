// What stands in the installer's place in a build that does not contain it (docs/ARCHITECTURE.md, 'The pro seam'): one plain line
// and one button to the way that works without it, the app export. The Build step uses it; it says what the export did.
import StudioSectionCard from './StudioSectionCard';
import { btnPrimary } from '@/components/shared/formStyles.js';

export const INSTALLER_NOT_IN_BUILD = 'Making an installer is not in this build. Export the app instead.';
export const EXPORT_APP = 'Export';

interface Props {
  onExport(): void;
  /** The status line after an export (empty before one). */
  notice: string;
}

export default function InstallerNotInBuild({ onExport, notice }: Props) {
  return (
    <StudioSectionCard>
      <div className="space-y-3">
        <p className="text-sm text-slate-slate200">{INSTALLER_NOT_IN_BUILD}</p>
        <div>
          <button type="button" className={btnPrimary} onClick={onExport}>
            {EXPORT_APP}
          </button>
        </div>
        <p role="status" className="text-sm text-accent-green empty:-mb-3">
          {notice}
        </p>
      </div>
    </StudioSectionCard>
  );
}
