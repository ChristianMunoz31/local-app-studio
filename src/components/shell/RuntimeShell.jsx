import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import AssistantAdvisor from '../assistant/AssistantAdvisor';
import { openAssistant } from '../assistant/openAssistant';
import { PageContextProvider } from '../../contexts/PageContextContext';
import { resolveAssistantPageKey } from '../../constants/assistantPages';
import { OPEN_ASSISTANT_SETUP_EVENT } from './setupEvent';

// The setup step of the first-run flow, in the chunk Onboarding.jsx already makes (no new chunk).
const OnboardingFlow = /* @__PURE__ */ lazy(() => import('../onboarding/OnboardingFlow'));

// The kit pages a built app keeps (Settings, and the Data pages reached from About this app): they get a way back.
const KIT_PAGE_PATTERNS = ['/settings', '/data', '/data/:table'];
const isKitPage = (pathname) => KIT_PAGE_PATTERNS.some((path) => matchPath({ path, caseSensitive: false, end: true }, pathname) !== null);

/**
 * The Set up Assistant dialog of a built app. It lives in the shell, not in the entry, so moving to /settings (the Export my
 * data item) while a model downloads does not drop it. After Finish or Skip the Assistant opens once the dialog has
 * unmounted, so the dialog's focus restore does not take focus back from the panel.
 */
function AssistantSetupHost() {
  const [open, setOpen] = useState(false);
  const finished = useRef(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT_SETUP_EVENT, show);
    return () => window.removeEventListener(OPEN_ASSISTANT_SETUP_EVENT, show);
  }, []);
  useEffect(() => {
    if (open || !finished.current) return;
    finished.current = false;
    openAssistant();
  }, [open]);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <OnboardingFlow
        assistantOnly
        onDone={() => {
          finished.current = true;
          setOpen(false);
        }}
        onDismiss={() => setOpen(false)}
      />
    </Suspense>
  );
}

/**
 * The frame of a built app: the designed app and nothing else, plus the Assistant host and a way back from the kit pages.
 * No top bar, burger, palette, trial notice or floating launcher (the entry lives in the designed menu bar, RuntimeEntry).
 * @param {{ appName?: string | null, backClass?: string, children?: import('react').ReactNode }} props
 */
export default function RuntimeShell({ appName = null, backClass = '', children }) {
  const { pathname } = useLocation();
  const assistantPageKey = resolveAssistantPageKey(pathname);

  // No TopBar publishes its height here; Settings' sticky offsets and scroll margins read it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--topbar-h', '0px');
    return () => root.style.removeProperty('--topbar-h');
  }, []);

  return (
    <PageContextProvider>
      {/* The theme's own mesh background, the same one Preview paints. */}
      <div id="bg-layer" aria-hidden="true" />
      <main data-runtime-shell="" tabIndex={-1} className="relative z-[1] min-h-screen min-w-0 focus:outline-hidden">
        {isKitPage(pathname) && (
          <div data-runtime-back="" className="border-b border-slate-slate700/60 p-2">
            <Link to="/" className={backClass}>
              <ArrowLeft size={16} aria-hidden="true" />
              {appName ? `Back to ${appName}` : 'Back to the app'}
            </Link>
          </div>
        )}
        {children}
      </main>
      <AssistantSetupHost />
      {/* Outside the z-[1] stacking context so its z-40 competes at root level; it opens through the entry. */}
      <AssistantAdvisor pageKey={assistantPageKey} visible={assistantPageKey !== null} showLauncher={false} autoAdvise={false} />
    </PageContextProvider>
  );
}
