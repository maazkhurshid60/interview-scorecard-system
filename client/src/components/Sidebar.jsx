import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Building2, GitBranch, Users, ScrollText,
  Settings as SettingsIcon, LogOut, X, ChevronLeft, ChevronRight, User, UserCog,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.svg';
import logoMark from '../assets/logo-mark.svg';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/requisitions', label: 'Job Openings', icon: Briefcase },
  { to: '/departments', label: 'Departments', icon: Building2 },
  { to: '/pipelines', label: 'Hiring Stages', icon: GitBranch },
  { to: '/candidates', label: 'Candidates', icon: Users },
  { to: '/users', label: 'Users & Roles', icon: UserCog, roles: ['owner', 'admin'] },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText, roles: ['owner', 'admin'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['owner', 'admin'] },
];

const SIDEBAR_COLLAPSED_KEY = 'interview_scorecard_sidebar_collapsed';

export default function Sidebar({ isOpen = false, onClose = () => { } }) {
  const { user, logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    }
    return false;
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return item.roles.includes(user?.role);
  });

  const formatRoleLabel = (r) => {
    if (!r) return 'User';
    if (r === 'owner') return 'Owner';
    if (r === 'admin') return 'Admin';
    if (r === 'hiring_manager') return 'Hiring Manager';
    if (r === 'recruiter') return 'Recruiter';
    if (r === 'interviewer') return 'Interviewer';
    return r.replace('_', ' ');
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-screen flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-300 ease-in-out md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'md:w-16' : 'md:w-60'} w-60`}
    >
      {/* Header */}
      <div className="relative flex items-center justify-between gap-2 px-3 py-3.5 border-b border-gray-100 min-h-[60px]">
        <div className={`flex items-center overflow-hidden ${isCollapsed ? 'md:justify-center md:w-full' : ''}`}>
          {/* Collapsed (desktop): only the circle mark fits. Otherwise: the full logo, which already carries the name. */}
          {isCollapsed && (
            <img
              src={logoMark}
              alt="OWNERS TALENT"
              title="OWNERS TALENT"
              className="hidden h-8 w-8 flex-shrink-0 object-contain md:block"
            />
          )}
          <img
            src={logo}
            alt="OWNERS TALENT"
            title="OWNERS TALENT"
            className={`h-9 w-auto max-w-full object-contain ${isCollapsed ? 'md:hidden' : ''}`}
          />
        </div>

        {/* Mobile close button */}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 md:hidden"
          title="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Desktop collapse toggle button */}
        <button
          type="button"
          onClick={toggleCollapse}
          className={`hidden md:flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-100 hover:text-gray-900 transition-colors flex-shrink-0 ${isCollapsed ? 'absolute -right-3 top-4 border-gray-300 z-50 bg-white shadow' : ''
            }`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1.5 px-2 py-3 overflow-y-auto overflow-x-hidden">
        {visibleNavItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            title={isCollapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors ${isCollapsed
                ? 'md:justify-center md:px-0 px-3'
                : 'px-3'
              } ${isActive
                ? 'bg-brand text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className={`${isCollapsed ? 'md:hidden' : 'block'} truncate`}>
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Footer / User Profile & Logout */}
      <div className="border-t border-gray-200 p-2.5">
        <div
          title={isCollapsed ? `${user?.name || 'User'} (${formatRoleLabel(user?.role)})` : undefined}
          className={`flex items-center gap-2.5 rounded-lg p-2 bg-white mb-2 ${isCollapsed ? 'md:justify-center md:px-0' : ''
            }`}
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand font-bold text-xs shadow-xs">
            {user?.name ? user.name.charAt(0).toUpperCase() : <User className="h-4 w-4" />}
          </div>
          <div className={`min-w-0 flex-1 ${isCollapsed ? 'md:hidden' : 'block'}`}>
            <div className="truncate text-xs font-bold text-gray-900 leading-snug">{user?.name || 'User'}</div>
            <div className="truncate text-[11px] text-gray-500 font-medium">
              <span className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                user?.role === 'owner' ? 'bg-purple-100 text-purple-700' :
                user?.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {formatRoleLabel(user?.role)}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          title={isCollapsed ? 'Log out' : undefined}
          className={`flex w-full items-center gap-2 rounded-md py-2 text-xs font-semibold text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors ${isCollapsed ? 'md:justify-center md:px-0 px-2.5' : 'px-2.5'
            }`}
        >
          <LogOut className="h-4 w-4 flex-shrink-0 text-gray-500 hover:text-red-600" />
          <span className={isCollapsed ? 'md:hidden' : 'block'}>Log out</span>
        </button>
      </div>
    </aside>
  );
}
