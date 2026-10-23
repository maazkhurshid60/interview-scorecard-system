import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Building2, Plus, Search, X, MoreVertical, Pencil, Trash2,
  Briefcase,
} from 'lucide-react';
import api from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { canManageDepartments } from '../lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PAGE_SIZE = 10;

function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export default function Departments() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageDepartments(user); // owner, admin, hiring manager

  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Dialog state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState(null); // null = create mode, object = edit mode
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteDept, setDeleteDept] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function loadDepartments() {
    setLoading(true);
    try {
      const res = await api.get('/departments');
      setDepartments(res.data.departments || []);
    } catch (err) {
      console.error('Failed to load departments:', err);
      toast.error(err?.response?.data?.message || 'Could not load departments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDepartments();
  }, []);

  function openCreateModal() {
    setEditingDept(null);
    setName('');
    setDescription('');
    setModalOpen(true);
  }

  function openEditModal(dept) {
    setEditingDept(dept);
    setName(dept.name || '');
    setDescription(dept.description || '');
    setModalOpen(true);
  }

  async function handleSaveDepartment(e) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('Department name is required.');
      return;
    }

    setSaving(true);
    try {
      if (editingDept) {
        const res = await api.patch(`/departments/${editingDept._id}`, {
          name: cleanName,
          description: description.trim(),
        });
        toast.success(res.data.message || `Department "${cleanName}" updated!`);
      } else {
        const res = await api.post('/departments', {
          name: cleanName,
          description: description.trim(),
        });
        toast.success(res.data.message || `Department "${cleanName}" created!`);
      }
      setModalOpen(false);
      loadDepartments();
    } catch (err) {
      console.error('Failed to save department:', err);
      toast.error(err?.response?.data?.message || 'Failed to save department.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDepartment() {
    if (!deleteDept) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/departments/${deleteDept._id}`);
      toast.success(res.data.message || `Department "${deleteDept.name}" deleted.`);
      setDeleteDept(null);
      loadDepartments();
    } catch (err) {
      console.error('Failed to delete department:', err);
      toast.error(err?.response?.data?.message || 'Could not delete department.');
    } finally {
      setDeleting(false);
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return departments;
    return departments.filter(
      (d) =>
        d.name?.toLowerCase().includes(query) ||
        d.description?.toLowerCase().includes(query)
    );
  }, [departments, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      {/* ---------- Header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <Building2 className="h-7 w-7 text-brand" />
              Departments
            </h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Loading…'
                : `${departments.length} department${departments.length === 1 ? '' : 's'} total`}
            </p>
          </div>
        </div>
        {canManage && (
          <Button
            className="bg-brand text-white hover:bg-brand/90 gap-1.5"
            onClick={openCreateModal}
          >
            <Plus className="h-4 w-4" />
            New Department
          </Button>
        )}
      </div>

      {/* ---------- Toolbar ---------- */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search departments…"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ---------- Table ---------- */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-base font-medium text-slate-800">
                {search ? 'No departments match your search.' : 'No departments created yet.'}
              </p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                {search
                  ? 'Try searching with a different keyword.'
                  : 'Organize your job openings by creating departments like Engineering, Design, or HR.'}
              </p>
              {!search && (
                <Button
                  className="mt-4 bg-brand text-white hover:bg-brand/90 gap-1.5"
                  onClick={openCreateModal}
                >
                  <Plus className="h-4 w-4" />
                  Add First Department
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/4 min-w-[180px]">Department Name</TableHead>
                    <TableHead className="min-w-[220px]">Description</TableHead>
                    <TableHead className="w-64 min-w-[240px] whitespace-nowrap">Associated Job Openings</TableHead>
                    <TableHead className="w-32 hidden md:table-cell whitespace-nowrap">Created</TableHead>
                    <TableHead className="w-14 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((dept) => (
                    <TableRow key={dept._id} className="hover:bg-slate-50/60">
                      <TableCell className="font-medium text-slate-900">
                        {dept.name}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 max-w-xs truncate">
                        {dept.description || <span className="text-slate-400 italic">No description</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge
                          variant="secondary"
                          className="cursor-pointer hover:bg-slate-200 gap-1.5 font-normal text-xs"
                          onClick={() => navigate(`/requisitions?departmentId=${dept._id}`)}
                          title="Filter job openings in this department"
                        >
                          <Briefcase className="h-3 w-3 text-slate-500" />
                          <span>
                            {dept.totalJobs || 0} job{dept.totalJobs === 1 ? '' : 's'}
                            {dept.openJobs > 0 ? ` (${dept.openJobs} active)` : ''}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-slate-500 whitespace-nowrap">
                        {formatDate(dept.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canManage && (
                              <DropdownMenuItem onClick={() => openEditModal(dept)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Department
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => navigate(`/requisitions?departmentId=${dept._id}`)}>
                              <Briefcase className="h-4 w-4 mr-2" />
                              View Job Openings
                            </DropdownMenuItem>
                            {canManage && (
                              <DropdownMenuItem
                                onClick={() => setDeleteDept(dept)}
                                className="text-red-600 focus:text-red-600 focus:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Department
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Pagination ---------- */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
          <span>
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ---------- Create / Edit Dialog ---------- */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingDept ? 'Edit Department' : 'Create Department'}
            </DialogTitle>
            <DialogDescription>
              {editingDept
                ? 'Update the department name and details.'
                : 'Add a new department to categorize job openings.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDepartment} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="dept-name">
                Department Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="dept-name"
                placeholder="e.g. Engineering, Sales, Human Resources"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dept-desc">
                Description <span className="text-xs text-muted-foreground">(Optional)</span>
              </Label>
              <Textarea
                id="dept-desc"
                placeholder="Briefly describe the functions or teams in this department…"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-brand hover:bg-brand/90 text-white"
              >
                {saving
                  ? 'Saving…'
                  : editingDept
                  ? 'Save Changes'
                  : 'Create Department'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- Delete Confirmation ---------- */}
      <AlertDialog open={Boolean(deleteDept)} onOpenChange={(open) => !open && setDeleteDept(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Department "{deleteDept?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span>
                Are you sure you want to delete this department? This action cannot be undone.
              </span>
              {deleteDept?.totalJobs > 0 && (
                <div className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-800 border border-amber-200 mt-2 font-medium">
                  ⚠️ Note: {deleteDept.totalJobs} job opening(s) are currently assigned to this department. They will not be deleted, but will become unassigned.
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDepartment}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting…' : 'Delete Department'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
