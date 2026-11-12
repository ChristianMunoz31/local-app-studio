import { Sparkles } from 'lucide-react';

/**
 * Round glass button, fixed bottom-right (above content z-[1] and TopBar z-30, below
 * modals z-50, the palette z-[60] and toasts z-[200]).
 * The accessible name is fixed; the page name is shown in the panel header. On mobile the
 * launcher is hidden while the sheet is open so it is not a hidden tab stop.
 * @param {{ ref?: import('react').Ref<HTMLButtonElement>, open: boolean, onToggle: () => void,
 *   onEscape: () => void, controlsId: string }} props
 */
export default function AssistantLauncher({ ref, open, onToggle, onEscape, controlsId }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape' && !e.nativeEvent?.isComposing) {
          e.stopPropagation();
          onEscape();
        }
      }}
      aria-label="Ask Assistant about this page"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? controlsId : undefined}
      className={`glass-assistant-fab fixed z-40 right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex h-12 w-12 items-center justify-center rounded-full text-accent-purple hover:text-slate-slate100 motion-safe:transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)] ${open ? 'max-sm:invisible' : ''}`}
    >
      <Sparkles size={20} aria-hidden="true" />
    </button>
  );
}
