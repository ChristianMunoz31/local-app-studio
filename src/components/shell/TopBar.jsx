import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { openCommandPalette } from '../../hooks/useCommandPalette';
import DevBuildBadge from './DevBuildBadge';
import TrialBadge from './TrialBadge';
import { useProfile } from '../../hooks/useProfile';

function greeting(hour) {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

/** True on a Mac; false when the platform is unknown (the Ctrl hint is the safe default). */
function isMacPlatform() {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const KEY_HINT_MAC = '⌘K';
const KEY_HINT_OTHER = 'Ctrl K';

export default function TopBar() {
  const { displayName } = useProfile();
  const keyHint = isMacPlatform() ? KEY_HINT_MAC : KEY_HINT_OTHER;
  const [now, setNow] = useState(() => new Date());
  const headerRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Publish the measured bar height so sticky offsets / scroll margins elsewhere stay exact.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const publish = () => {
      if (el.offsetHeight > 0) {
        document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
      }
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      data-topbar=""
      ref={headerRef}
      className="sticky top-0 z-30 flex items-center justify-between gap-3 sm:gap-4 pl-16 pr-4 sm:pr-6 py-3 glass-strong border-x-0 border-t-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-slate100 tracking-tight">
            {displayName ? `${greeting(now.getHours())}, ${displayName}` : greeting(now.getHours())}
          </h1>
          <p className="truncate text-xs text-slate-slate400 mt-0.5">{DATE_FMT.format(now)}</p>
        </div>

        <DevBuildBadge />
        <TrialBadge />
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Command palette / search (Ctrl K, or ⌘K on a Mac) */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Search"
          className="glass-subtle flex items-center gap-2 px-3 py-2.5 rounded-md text-slate-slate400 hover:text-slate-slate100 hover:bg-slate-slate700/50 transition-colors md:min-w-[10.5rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
        >
          <Search size={16} />
          <span className="hidden md:inline text-xs">Search</span>
          <kbd className="hidden md:inline ml-auto text-[10px] px-1 py-0.5 rounded border border-slate-slate700 bg-slate-slate700/40 text-slate-slate400">
            {keyHint}
          </kbd>
        </button>

        <div className="text-right hidden sm:block border-l border-slate-slate700/60 pl-3 ml-1">
          <div className="text-sm font-semibold text-slate-slate200 tabular-nums leading-none">
            {TIME_FMT.format(now)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-slate500 mt-0.5">
            local time
          </div>
        </div>
      </div>
    </header>
  );
}
