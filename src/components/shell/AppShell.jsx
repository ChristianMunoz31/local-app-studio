import { useLocation } from 'react-router-dom';
import BurgerMenu from './BurgerMenu';
import TopBar from './TopBar';
import LazyCommandPalette from '../palette/LazyCommandPalette';
import AssistantAdvisor from '../assistant/AssistantAdvisor';
import TrialNotice from '../license/TrialNotice';
import { PageContextProvider } from '../../contexts/PageContextContext';
import { useAssistantSettings } from '../../hooks/useAssistantSettings';
import { resolveAssistantPageKey } from '../../constants/assistantPages';
import { routeKey } from './routeKey';

export default function AppShell({ children }) {
  const location = useLocation();
  const { showButton, autoAdvise } = useAssistantSettings();
  const assistantPageKey = resolveAssistantPageKey(location.pathname);
  // `showButton` only hides the floating launcher; Assistant stays available (palette, assistant:open).
  const assistantAvailable = assistantPageKey !== null;
  const launcherShown = showButton && assistantAvailable;

  return (
    <PageContextProvider>
      {/* Static mesh background (gradients live in index.css): decorative, behind all content */}
      <div id="bg-layer" aria-hidden="true" />

      <div className="relative z-[1] min-h-screen flex">
        <BurgerMenu />
        <main tabIndex={-1} className="flex-1 min-w-0 flex flex-col focus:outline-hidden">
          <TopBar />
          <TrialNotice />
          {/* Keyed on the top-level segment so switching modules replays the
              fade/slide-in, while sub-routes within a module (e.g. /apps to
              /apps/new) don't re-animate or remount.
              (Animation is disabled under prefers-reduced-motion; see index.css.)
              Bottom padding keeps the Assistant launcher from covering page controls. */}
          <div
            key={routeKey(location.pathname)}
            className={`flex-1 min-w-0 animate-page-in ${launcherShown ? 'pb-24' : ''}`}
          >
            {children}
          </div>
        </main>
        <LazyCommandPalette assistantAvailable={assistantAvailable} />
      </div>

      {/* Outside the z-[1] stacking context so its z-40 competes at root level. */}
      <AssistantAdvisor pageKey={assistantPageKey} visible={assistantAvailable} showLauncher={showButton} autoAdvise={autoAdvise} />
    </PageContextProvider>
  );
}
