import { useEffect, useId, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import Modal from '../shared/Modal';
import OllamaSetup from '../shared/OllamaSetup';
import { btnPrimary, btnSecondary, inputClass, labelClass } from '../shared/formStyles';
import { useProfile } from '../../hooks/useProfile';

const STEP_TITLE = { welcome: 'Welcome to Local App Studio', ai: 'Set up Assistant' };

/**
 * First-run welcome: privacy promise, optional display name, optional Ollama setup for Assistant.
 * Skip and Finish mark the profile onboarded; Escape/backdrop/close only hide it
 * (welcome step, nothing typed) so typed input is never silently discarded.
 * `assistantOnly` (a built app's first press of Assistant) opens on the Assistant step with no Back; Finish and Skip for now
 * call `onDone` and save nothing, and the dialog can be closed while no download runs.
 * @param {{ onDismiss?: () => void, assistantOnly?: boolean, onDone?: () => void }} props
 */
export default function OnboardingFlow({ onDismiss, assistantOnly = false, onDone }) {
  const { save } = useProfile();
  const [step, setStep] = useState(assistantOnly ? 'ai' : 'welcome');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const nameId = useId();
  const descId = useId();
  const pullHintId = useId();
  const nameRef = useRef(null);
  const aiIntroRef = useRef(null);

  // The modal focuses the first field on mount; later steps move focus themselves. On the Assistant
  // step the intro paragraph takes focus so the step change is announced and Tab starts there.
  useEffect(() => {
    if (step === 'ai') aiIntroRef.current?.focus();
    else nameRef.current?.focus();
  }, [step]);

  const finish = async ({ withName }) => {
    if (assistantOnly) {
      onDone?.();
      return;
    }
    if (busy) return;
    setBusy(true);
    const trimmed = name.trim();
    await save(withName && trimmed ? { displayName: trimmed, onboarded: true } : { onboarded: true });
  };

  const dismissible = assistantOnly ? !pulling && Boolean(onDismiss) : step === 'welcome' && name.trim() === '' && Boolean(onDismiss);

  const skip = () => finish({ withName: false });

  return (
    <Modal
      title={STEP_TITLE[step]}
      onClose={() => onDismiss?.()}
      dismissible={dismissible}
      describedBy={descId}
    >
      {step === 'welcome' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStep('ai');
          }}
        >
          <div
            id={descId}
            className="mb-4 flex gap-3 rounded-lg bg-slate-slate700/40 p-3 text-sm text-slate-slate300"
          >
            <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-slate400" />
            <p>
              Your data stays on this device. Nothing calls the internet unless you turn it on in
              Settings.
            </p>
          </div>
          <label htmlFor={nameId} className={labelClass}>
            What should Local App Studio call you? (optional)
          </label>
          <input
            id={nameId}
            ref={nameRef}
            type="text"
            value={name}
            maxLength={60}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={inputClass}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={skip} disabled={busy} className={btnSecondary}>
              Skip for now
            </button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              Continue
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p
            id={descId}
            ref={aiIntroRef}
            tabIndex={-1}
            className="mb-3 text-sm text-slate-slate300 focus:outline-hidden"
          >
            Assistant is Local App Studio&apos;s built-in AI helper. It is optional, and you can set it up later in
            Settings.
          </p>
          <OllamaSetup onReady={() => setAiReady(true)} onBusyChange={setPulling} />
          {pulling && (
            <p id={pullHintId} className="mt-3 text-right text-xs text-slate-slate300">
              Finish or cancel the download to continue
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {!assistantOnly && (
              <button
                type="button"
                onClick={() => setStep('welcome')}
                disabled={pulling}
                aria-describedby={pulling ? pullHintId : undefined}
                className={btnSecondary}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => finish({ withName: true })}
              disabled={pulling || busy}
              aria-describedby={pulling ? pullHintId : undefined}
              className={aiReady ? btnPrimary : btnSecondary}
            >
              {aiReady ? 'Finish' : 'Skip for now'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
