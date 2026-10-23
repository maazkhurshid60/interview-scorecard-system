import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UserCog, Plus, Search, X, Pencil, Trash2, Shield, Crown, User,
  Check, AlertCircle, Eye, EyeOff, Lock, Users as UsersIcon, CheckCircle2,
  RotateCw, Copy, ShieldCheck, Sparkles, KeyRound, CheckSquare, XCircle,
} from 'lucide-react';
import api from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const ROLE_CONFIG = {
  owner: {
    label: 'Owner',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
    avatarClass: 'bg-purple-100 text-purple-800 border-purple-200',
    icon: Crown,
    title: 'Super-Administrator',
    description: 'Unrestricted permissions across all modules, system settings, billing, AI spend limits, and user administration.',
    permissions: [
      'Manage all users, roles & system security',
      'Create, edit, and delete job openings & candidates',
      'Configure hiring pipelines & departments',
      'View & manage AI spend cap & API keys',
      'Access full audit logs & system analytics',
      'Evaluate candidates and submit scorecards',
    ],
  },
  admin: {
    label: 'Admin',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
    avatarClass: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Shield,
    title: 'System Administrator',
    description: 'Can manage team members, job openings, departments, and settings, but cannot modify Owner accounts or assign Owner role.',
    permissions: [
      'Manage team members & assign non-owner roles',
      'Create, edit, and delete job openings & candidates',
      'Configure hiring stages & evaluation criteria',
      'View AI spend & system activity logs',
      'Evaluate candidates and submit scorecards',
    ],
  },
  hiring_manager: {
    label: 'Hiring Manager',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    avatarClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    icon: UserCog,
    title: 'Hiring Manager',
    description: 'Leads hiring processes, reviews applicants, coordinates stages, and makes final hire/reject decisions.',
    permissions: [
      'View candidates and track hiring progress',
      'Move candidates between interview stages',
      'Conduct interviews and complete scorecards',
      'Make hire, hold, or reject decisions',
      'Add feedback and interview notes',
    ],
  },
  recruiter: {
    label: 'Recruiter',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    avatarClass: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: UsersIcon,
    title: 'Talent Acquisition',
    description: 'Sources talent, creates candidate profiles, attaches candidates to openings, and conducts initial screenings.',
    permissions: [
      'Create and update candidate profiles',
      'Attach & detach candidates to job openings',
      'Conduct initial screening & questionnaire reviews',
      'Schedule interview sessions with team',
      'Review scorecards & feedback summaries',
    ],
  },
  interviewer: {
    label: 'Interviewer',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    avatarClass: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: User,
    title: 'Interview Evaluator',
    description: 'Evaluates candidates in assigned interview rounds, asks rubric-driven questions, and submits scorecards.',
    permissions: [
      'Access candidate résumés for assigned rounds',
      'Conduct assigned interviews via scorecard room',
      'Rate competencies and provide qualitative feedback',
      'Submit and review personal interview scorecards',
    ],
  },
};

const PERMISSIONS_MATRIX = [
  { feature: 'Manage System Users & Roles', owner: true, admin: true, hiring_manager: false, recruiter: false, interviewer: false },
  { feature: 'View System Audit Logs', owner: true, admin: true, hiring_manager: false, recruiter: false, interviewer: false },
  { feature: 'Manage AI Spend Caps & Settings', owner: true, admin: true, hiring_manager: false, recruiter: false, interviewer: false },
  { feature: 'Delete Jobs & Candidate Records', owner: true, admin: true, hiring_manager: false, recruiter: false, interviewer: false },
  { feature: 'Create & Edit Job Openings', owner: true, admin: true, hiring_manager: true, recruiter: true, interviewer: false },
  { feature: 'Configure Pipelines & Stages', owner: true, admin: true, hiring_manager: true, recruiter: false, interviewer: false },
  { feature: 'Create & Attach Candidates', owner: true, admin: true, hiring_manager: true, recruiter: true, interviewer: false },
  { feature: 'Change Stage / Disposition Decisions', owner: true, admin: true, hiring_manager: true, recruiter: true, interviewer: false },
  { feature: 'Conduct Interviews & Scorecards', owner: true, admin: true, hiring_manager: true, recruiter: true, interviewer: true },
];

function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function generateRandomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
  let pass = '';
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const isOwner = currentUser?.role === 'owner';
  const isAdmin = currentUser?.role === 'admin';

  const [activeTab, setActiveTab] = useState('directory');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('recruiter');
  const [formActive, setFormActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.get('/users');
      setUsers(res.data.users || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = search.toLowerCase().trim();
      const matchSearch = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? u.active : !u.active);
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  // Metrics
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.active).length;
    const owners = users.filter((u) => u.role === 'owner').length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const hiringManagers = users.filter((u) => u.role === 'hiring_manager').length;
    const recruiters = users.filter((u) => u.role === 'recruiter').length;
    const interviewers = users.filter((u) => u.role === 'interviewer').length;

    return {
      total,
      active,
      inactive: total - active,
      owners,
      admins,
      hiringManagers,
      recruiters,
      interviewers,
      activePercent: total > 0 ? Math.round((active / total) * 100) : 100,
    };
  }, [users]);

  // Roles available to assign
  const assignableRoles = useMemo(() => {
    if (isOwner) {
      return ['owner', 'admin', 'hiring_manager', 'recruiter', 'interviewer'];
    }
    return ['admin', 'hiring_manager', 'recruiter', 'interviewer'];
  }, [isOwner]);

  const openAddModal = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('recruiter');
    setFormActive(true);
    setShowPassword(false);
    setModalOpen(true);
  };

  const openEditModal = (target) => {
    if (target.role === 'owner' && !isOwner) {
      toast.error('Admins cannot edit or modify an Owner account.');
      return;
    }
    setEditingUser(target);
    setFormName(target.name || '');
    setFormEmail(target.email || '');
    setFormPassword('');
    setFormRole(target.role || 'recruiter');
    setFormActive(target.active !== false);
    setShowPassword(false);
    setModalOpen(true);
  };

  const handleCopyEmail = (email, event) => {
    if (event) event.stopPropagation();
    navigator.clipboard.writeText(email);
    toast.success('Email copied to clipboard');
  };

  const handleQuickToggleActive = async (target, event) => {
    if (event) event.stopPropagation();
    if (target.role === 'owner' && !isOwner) {
      toast.error('Admins cannot modify an Owner account.');
      return;
    }

    const nextStatus = !target.active;
    try {
      await api.patch(`/users/${target._id}`, { active: nextStatus });
      toast.success(`${target.name} is now ${nextStatus ? 'active' : 'suspended'}.`);
      fetchUsers(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not update status.');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Full name is required.');
      return;
    }
    if (!formEmail.trim()) {
      toast.error('Email address is required.');
      return;
    }
    if (!editingUser && (!formPassword || formPassword.length < 6)) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    if (editingUser && formPassword && formPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (formRole === 'owner' && !isOwner) {
      toast.error('Only an Owner can assign the Owner role.');
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        const payload = {
          name: formName.trim(),
          email: formEmail.trim(),
          role: formRole,
          active: formActive,
        };
        if (formPassword.trim()) {
          payload.password = formPassword.trim();
        }
        const res = await api.patch(`/users/${editingUser._id}`, payload);
        toast.success(res.data.message || 'User updated successfully.');
      } else {
        const payload = {
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword.trim(),
          role: formRole,
        };
        const res = await api.post('/users', payload);
        toast.success(res.data.message || 'User created successfully.');
      }
      setModalOpen(false);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Operation failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/users/${deleteTarget._id}`);
      toast.success(res.data.message || 'User deleted successfully.');
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete user.');
    } finally {
      setDeleting(false);
    }
  };

  const hasActiveFilters = search || roleFilter !== 'all' || statusFilter !== 'all';

  const resetFilters = () => {
    setSearch('');
    setRoleFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-brand">
              <UserCog className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Users & Roles
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Manage team accounts, assign roles, and review security access permissions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUsers(true)}
            disabled={loading || refreshing}
            className="h-9 px-3 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="Refresh user list"
          >
            <RotateCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            onClick={openAddModal}
            size="sm"
            className="h-9 bg-brand hover:bg-brand/90 text-white font-medium shadow-sm gap-1.5 text-xs px-3.5"
          >
            <Plus className="h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <Card className="border shadow-sm transition-all hover:shadow-md">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
              <UsersIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                Total Members
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <p className="text-2xl font-bold text-foreground">
                  {loading ? '—' : stats.total}
                </p>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  in system
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm transition-all hover:shadow-md">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                Active Accounts
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {loading ? '—' : stats.active}
                </p>
                {!loading && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-200 bg-emerald-50 text-emerald-700 font-normal">
                    {stats.activePercent}%
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm transition-all hover:shadow-md">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/40 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
              <Crown className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                Owners & Admins
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                  {loading ? '—' : stats.owners + stats.admins}
                </p>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  ({stats.owners} own, {stats.admins} adm)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm transition-all hover:shadow-md">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                Hiring & Reviewers
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {loading ? '—' : stats.hiringManagers + stats.recruiters + stats.interviewers}
                </p>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  reviewers
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Directory vs Permissions Matrix */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
          <TabsList className="bg-muted/70 p-1">
            <TabsTrigger value="directory" className="gap-2 text-xs">
              <UsersIcon className="h-3.5 w-3.5" />
              <span>User Directory</span>
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {loading ? '…' : users.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2 text-xs">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Roles & Permissions Guide</span>
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                5
              </Badge>
            </TabsTrigger>
          </TabsList>

          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>Signed in as:</span>
            <Badge variant="outline" className={`font-medium text-xs px-2 py-0.5 ${ROLE_CONFIG[currentUser?.role]?.badgeClass || ''}`}>
              {ROLE_CONFIG[currentUser?.role]?.label || currentUser?.role}
            </Badge>
          </div>
        </div>

        {/* Tab 1: User Directory */}
        <TabsContent value="directory" className="space-y-4 mt-0">
          {/* Filter Bar */}
          <Card className="border shadow-sm">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email address..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 pr-8 text-sm h-9 bg-muted/20"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Status Pills */}
                  <div className="inline-flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setStatusFilter('all')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                        statusFilter === 'all'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      All ({stats.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('active')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                        statusFilter === 'active'
                          ? 'bg-background text-emerald-600 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Active ({stats.active})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('inactive')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                        statusFilter === 'inactive'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Inactive ({stats.inactive})
                    </button>
                  </div>

                  {/* Role Selector */}
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="h-9 w-[160px] text-xs">
                      <SelectValue placeholder="Filter by Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="hiring_manager">Hiring Manager</SelectItem>
                      <SelectItem value="recruiter">Recruiter</SelectItem>
                      <SelectItem value="interviewer">Interviewer</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Reset Filters Button */}
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetFilters}
                      className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Users Table */}
          <Card className="border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40 border-b">
                  <TableRow>
                    <TableHead className="font-semibold min-w-[240px]">User & Email</TableHead>
                    <TableHead className="font-semibold w-48">System Role</TableHead>
                    <TableHead className="font-semibold w-32">Status</TableHead>
                    <TableHead className="font-semibold w-36">Member Since</TableHead>
                    <TableHead className="font-semibold text-right w-28">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-9 w-9 rounded-full" />
                            <div className="space-y-1.5">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-44" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Skeleton className="h-6 w-28 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-14 text-center text-muted-foreground">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <UsersIcon className="h-8 w-8 text-muted-foreground/50" />
                          <p className="text-sm font-medium">
                            {hasActiveFilters ? 'No users match your active filters.' : 'No users found.'}
                          </p>
                          {hasActiveFilters && (
                            <Button variant="outline" size="sm" onClick={resetFilters} className="mt-2 text-xs">
                              Clear all filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((u) => {
                      const roleMeta = ROLE_CONFIG[u.role] || ROLE_CONFIG.recruiter;
                      const RoleIcon = roleMeta.icon;
                      const isSelf = String(u._id) === String(currentUser?._id);
                      const isTargetOwner = u.role === 'owner';
                      const canEdit = isOwner || !isTargetOwner;
                      const canDelete = !isSelf && (isOwner || !isTargetOwner);

                      return (
                        <TableRow key={u._id} className="hover:bg-muted/30 transition-colors group">
                          {/* Name & Email */}
                          <TableCell className="py-3">
                            <div className="flex items-center gap-3">
                              <Avatar className={`h-9 w-9 border ${roleMeta.avatarClass}`}>
                                <AvatarFallback className="font-bold text-xs bg-transparent">
                                  {getInitials(u.name)}
                                </AvatarFallback>
                              </Avatar>

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground text-sm truncate">
                                    {u.name}
                                  </span>
                                  {isSelf && (
                                    <Badge variant="outline" className="text-[10px] bg-brand/10 text-brand border-brand/30 px-1.5 py-0 h-4 font-normal">
                                      You
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="truncate">{u.email}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopyEmail(u.email, e)}
                                    className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                                    title="Copy email address"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          {/* Role Badge */}
                          <TableCell className="py-3">
                            <Badge
                              variant="outline"
                              className={`inline-flex items-center gap-1.5 font-medium text-xs px-2.5 py-0.5 border shadow-none ${roleMeta.badgeClass}`}
                            >
                              <RoleIcon className="h-3 w-3 shrink-0" />
                              {roleMeta.label}
                            </Badge>
                          </TableCell>

                          {/* Active Status */}
                          <TableCell className="py-3">
                            {canEdit && !isSelf ? (
                              <button
                                type="button"
                                onClick={(e) => handleQuickToggleActive(u, e)}
                                title={`Click to ${u.active ? 'suspend' : 'activate'} this user`}
                                className="group/status inline-flex items-center"
                              >
                                {u.active ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 group-hover/status:border-emerald-300 px-2.5 py-0.5 rounded-full transition-colors">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 group-hover/status:border-slate-300 px-2.5 py-0.5 rounded-full transition-colors">
                                    Suspended
                                  </span>
                                )}
                              </button>
                            ) : (
                              u.active ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full">
                                  Suspended
                                </span>
                              )
                            )}
                          </TableCell>

                          {/* Created Date */}
                          <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(u.createdAt)}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="py-3 text-right">
                            {isTargetOwner && !isOwner ? (
                              <div
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground italic bg-muted/40 border border-border rounded px-2 py-1"
                                title="Admins cannot modify Owner accounts"
                              >
                                <Lock className="h-3 w-3" /> Protected
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 justify-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={!canEdit}
                                  onClick={() => openEditModal(u)}
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                                  title="Edit user details and role"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={!canDelete}
                                  onClick={() => setDeleteTarget(u)}
                                  className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30"
                                  title={isSelf ? 'Cannot delete your own account' : 'Delete user account'}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Table Footer Summary */}
            {!loading && filteredUsers.length > 0 && (
              <div className="px-4 py-2.5 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {filteredUsers.length} of {users.length} user{users.length === 1 ? '' : 's'}
                </span>
                <span>
                  {stats.active} active account{stats.active === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Tab 2: Roles & Permissions Guide */}
        <TabsContent value="roles" className="space-y-6 mt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(ROLE_CONFIG).map(([key, config]) => {
              const RoleIcon = config.icon;
              const count = users.filter((u) => u.role === key).length;

              return (
                <Card key={key} className="border shadow-sm flex flex-col justify-between transition-all hover:shadow-md">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${config.avatarClass}`}>
                          <RoleIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                            {config.label}
                          </h3>
                          <p className="text-[11px] text-muted-foreground">{config.title}</p>
                        </div>
                      </div>

                      <Badge variant="outline" className={`text-xs px-2 py-0.5 font-medium ${config.badgeClass}`}>
                        {count} member{count === 1 ? '' : 's'}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {config.description}
                    </p>

                    <div className="space-y-1.5 pt-2 border-t">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Included Privileges:
                      </p>
                      <ul className="space-y-1">
                        {config.permissions.map((perm, idx) => (
                          <li key={idx} className="flex items-start gap-1.5 text-xs text-foreground/90">
                            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{perm}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Permissions Matrix Table */}
          <Card className="border shadow-sm overflow-hidden">
            <div className="p-4 border-b bg-muted/20">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-brand" />
                Feature Access & Security Matrix
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Overview of capability permissions mapped across each role in the system.
              </p>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="font-semibold min-w-[240px]">Platform Capability</TableHead>
                    <TableHead className="font-semibold text-center w-28">Owner</TableHead>
                    <TableHead className="font-semibold text-center w-28">Admin</TableHead>
                    <TableHead className="font-semibold text-center w-36">Hiring Manager</TableHead>
                    <TableHead className="font-semibold text-center w-28">Recruiter</TableHead>
                    <TableHead className="font-semibold text-center w-28">Interviewer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PERMISSIONS_MATRIX.map((row, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/20">
                      <TableCell className="font-medium text-xs text-foreground py-2.5">
                        {row.feature}
                      </TableCell>
                      <TableCell className="text-center py-2.5">
                        {row.owner ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-2.5">
                        {row.admin ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-2.5">
                        {row.hiring_manager ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-2.5">
                        {row.recruiter ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-2.5">
                        {row.interviewer ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add / Edit User Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md p-6 shadow-xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <UserCog className="h-5 w-5 text-brand" />
              {editingUser ? 'Edit User & Permissions' : 'Add New Team Member'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {editingUser
                ? `Update account details, role assignments, or credentials for ${editingUser.name}.`
                : 'Create an account and assign appropriate permissions for this member.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 pt-2">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label htmlFor="user-name" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Full Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="user-name"
                type="text"
                placeholder="e.g. Sarah Jenkins"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                className="h-9 text-sm"
              />
            </div>

            {/* Email Address */}
            <div className="space-y-1.5">
              <Label htmlFor="user-email" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Email Address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="user-email"
                type="email"
                placeholder="sarah.jenkins@company.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
                className="h-9 text-sm"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
                  <Label htmlFor="user-password" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    {editingUser ? 'New Password' : 'Password'}
                  </Label>
                  {editingUser ? (
                    <span className="text-[11px] normal-case font-normal text-muted-foreground">(Optional)</span>
                  ) : (
                    <span className="text-red-500 font-bold">*</span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] whitespace-nowrap shrink-0">
                  {editingUser && (
                    <span className="text-muted-foreground">Leave empty to keep</span>
                  )}
                  {editingUser && <span className="text-muted-foreground/40">•</span>}
                  <button
                    type="button"
                    onClick={() => {
                      const gen = generateRandomPassword();
                      setFormPassword(gen);
                      setShowPassword(true);
                      toast.success('Generated strong password');
                    }}
                    className="text-brand hover:underline flex items-center gap-1 font-medium"
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span>Auto-generate</span>
                  </button>
                </div>
              </div>
              <div className="relative">
                <Input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={editingUser ? 'Leave blank to retain existing password' : 'Min. 6 characters'}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  required={!editingUser}
                  minLength={6}
                  className="h-9 text-sm pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Role Select */}
            <div className="space-y-1.5">
              <Label htmlFor="user-role" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Assign System Role <span className="text-red-500">*</span>
              </Label>
              <Select value={formRole} onValueChange={setFormRole}>
                <SelectTrigger id="user-role" className="h-9 text-sm">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => {
                    const meta = ROLE_CONFIG[r];
                    const Icon = meta?.icon || User;
                    return (
                      <SelectItem key={r} value={r}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{meta?.label || r}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{ROLE_CONFIG[formRole]?.title}</p>
                <p className="mt-0.5 leading-relaxed">{ROLE_CONFIG[formRole]?.description}</p>
              </div>
            </div>

            {/* Active Status (Only in Edit mode) */}
            {editingUser && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="user-status" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Account Status
                </Label>
                <Select
                  value={formActive ? 'active' : 'inactive'}
                  onValueChange={(val) => setFormActive(val === 'active')}
                >
                  <SelectTrigger id="user-status" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (Can log in & access system)</SelectItem>
                    <SelectItem value="inactive">Suspended (Access temporarily revoked)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter className="pt-3 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                className="bg-brand hover:bg-brand/90 text-white font-medium shadow-sm"
              >
                {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Delete User Account?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm">
              Are you sure you want to permanently delete{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong> (
              {deleteTarget?.email})? This action cannot be undone and will revoke their system access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
