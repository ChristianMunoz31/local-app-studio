import { Link } from 'react-router-dom';
import BackupHealthNotice from '../components/home/BackupHealthNotice';
import { MODULE_NAV_GROUPS } from '../modules';
import { usePageContext } from '../contexts/PageContextContext';
import { buildHomeContext } from '../utils/assistantBuilders/home';

const CARD =
  'glass rounded-2xl p-5 flex items-center gap-3 text-sm font-semibold text-slate-slate100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';

// One link per module nav item, so a new module shows up here with no change to this page.
const MODULE_LINKS = MODULE_NAV_GROUPS.flatMap((group) => group.items);

export default function Home() {
  usePageContext('home', () => buildHomeContext({ sections: MODULE_LINKS.map((link) => link.label) }));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <BackupHealthNotice />
      <div className="mb-5 scroll-reveal">
        <h2 className="text-xl font-bold text-slate-slate100 tracking-tight">Overview</h2>
        <p className="text-sm text-slate-slate400 mt-1">Your data stays on this computer.</p>
      </div>

      {MODULE_LINKS.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULE_LINKS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className={CARD}>
                {Icon && <Icon size={16} className="text-slate-slate400" aria-hidden="true" />}
                {label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
