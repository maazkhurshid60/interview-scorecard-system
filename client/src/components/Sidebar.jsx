import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Briefcase, GitBranch, Users, ScrollText, Settings as SettingsIcon, LogOut, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/requisitions', label: 'Requisitions', icon: Briefcase },
  { to: '/pipelines', label: 'Pipelines', icon: GitBranch },
  { to: '/candidates', label: 'Candidates', icon: Users },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Sidebar navigation — top-level pages only; RequisitionDetail/InterviewRoom are reached by drilling in, not from here.
 * Below the `md` breakpoint this becomes a slide-in drawer controlled by `isOpen`/`onClose` (owned by Layout);
 * at `md:` and up it always renders exactly as before, ignoring that state entirely.
 * @param {{isOpen?: boolean, onClose?: () => void}} props
 */
export default function Sidebar({ isOpen = false, onClose = () => {} }) {
  const { user, logout } = useAuth();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-screen w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Interview Scorecard</h1>
          <p className="text-xs text-gray-400">Red Star Technologies</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-[#d21e2b] text-white' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <div className="mb-2 text-xs text-gray-500">
          <div className="font-medium text-gray-700">{user?.name}</div>
          <div>{user?.role}</div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}
