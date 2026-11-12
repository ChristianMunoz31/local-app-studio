import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CircleHelp } from 'lucide-react';
import Modal from '@/components/shared/Modal.jsx';
import { btnSecondary } from '@/components/shared/formStyles.js';
import { useHelpShortcut } from '../hooks/useHelpShortcut';
import { EXAMPLES_HELP } from '../lib/examples';
import { shortcutAreas } from '../lib/shortcuts';
import { STEPS, stepIntro } from '../lib/steps';

const SAVING =
  'Moving to another step saves your changes. If they cannot be saved, Studio says why and asks first. Save, or Ctrl+S, saves without moving. Undo takes back the last change on Design and Data.';
export const HELPER_CANNOT_ANSWER = 'If the helper cannot answer, press Build it yourself and start with your tables on Data.';
const HEAD = 'py-1 pr-3 text-left text-xs font-semibold text-slate-slate300';

function HelpSheet({ onClose, finalFocusRef }: { onClose(): void; finalFocusRef: RefObject<HTMLElement | null> }) {
  return (
    <Modal title="Help and keyboard shortcuts" onClose={onClose} size="lg" finalFocusRef={finalFocusRef}>
      <div className="space-y-5 text-sm text-slate-slate300">
        <section aria-labelledby="help-steps">
          <h3 id="help-steps" className="mb-1 text-sm font-semibold text-slate-slate100">
            How making an app works
          </h3>
          <ol className="space-y-1">
            {STEPS.map((step) => (
              <li key={step.id}>
                <span className="font-medium text-slate-slate100">{step.label}</span>: {stepIntro(step.id)}
              </li>
            ))}
          </ol>
          <p className="mt-2">{HELPER_CANNOT_ANSWER}</p>
          <p className="mt-2">{EXAMPLES_HELP}</p>
        </section>
        <section aria-labelledby="help-saving">
          <h3 id="help-saving" className="mb-1 text-sm font-semibold text-slate-slate100">
            Saving
          </h3>
          <p>{SAVING}</p>
        </section>
        {shortcutAreas().map((area) => (
          <section key={area.where}>
            <table className="w-full border-collapse">
              <caption className="mb-1 text-left text-sm font-semibold text-slate-slate100">{area.where}</caption>
              <thead>
                <tr>
                  <th scope="col" className={HEAD}>
                    Keys
                  </th>
                  <th scope="col" className={HEAD}>
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody>
                {area.rows.map((row) => (
                  <tr key={`${row.keys}|${row.does}`} className="align-top">
                    <td className="py-1 pr-3">
                      <kbd className="rounded border border-slate-slate600 bg-slate-slate800 px-1.5 py-0.5 font-mono text-xs text-slate-slate100">{row.keys}</kbd>
                    </td>
                    <td className="py-1">{row.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** The Help button; owns the sheet and opens it on ? as well. Focus returns to the button. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useHelpShortcut(() => setOpen(true));
  return (
    <>
      <button ref={buttonRef} type="button" className={`${btnSecondary} inline-flex items-center gap-1.5`} onClick={() => setOpen(true)}>
        <CircleHelp size={14} aria-hidden="true" />
        Help
      </button>
      {open && <HelpSheet onClose={() => setOpen(false)} finalFocusRef={buttonRef} />}
    </>
  );
}

export default HelpButton;
