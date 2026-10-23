import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, ArrowLeft, Search, X, Briefcase, ChevronRight, Check, ChevronsUpDown, Users, Sparkles, Copy, Link2, Trash2, MoreVertical, Building2, Pencil, Clock, Calendar as CalendarIcon,
} from 'lucide-react';
import api from '../hooks/useApi';
import { fetchRequisitionsList, fetchPipelinesList, fetchDepartmentsList } from '../hooks/queries';
import dayjs from 'dayjs';
import { TimePicker } from '@/components/ui/time-picker';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { formatDate } from '../utils/formatters';
import screeningCriteriaConfig from '../constants/screeningCriteria.json';
import { goBackToJob } from '../lib/interviewNavigation';
import { useAuth } from '../context/AuthContext';
import { canDeleteRecords, canManageRequisitions } from '../lib/permissions';

const PAGE_SIZE = 10;
const JOB_TITLE_MIN_LENGTH = 5;

const normalizeJobTitle = (title) => title.replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ').trim();
const isBlankField = (value) => typeof value !== 'string' || !value.trim();
const stripHtml = (html) => (html || '').replace(/<[^>]*>/g, '').trim();

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link', 'clean'],
  ],
};

const STATUS_BADGE = {
  open: 'bg-green-100 text-green-800 hover:bg-green-100',
  paused: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  on_hold: 'bg-amber-100 text-amber-800 hover:bg-amber-100', // legacy records
  closed: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
  draft: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
};
const STATUS_LABEL = { open: 'Open', paused: 'Paused', on_hold: 'Paused', closed: 'Closed', draft: 'Draft' };
const EMPLOYMENT_TYPE_LABEL = {
  full_time: 'Full-Time',
  part_time: 'Part-Time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
};

const EMPTY_FORM = {
  title: '',
  employmentType: 'full_time',
  fullTimeDetails: { workingHours: '' },
  partTimeDetails: { weeklyHours: '', workingHours: '' },
  contractDetails: { duration: '', workingHours: '', paymentRate: '' },
  internshipDetails: { duration: '', paidStatus: 'paid', workingHours: '' },
  temporaryDetails: { startDate: '', endDate: '', workingHours: '' },
  workplaceType: 'remote',
  officeLocation: '',
  remoteRegion: '',
  jobDescription: '',
  initialScreeningCriteria: [
    { criteria: screeningCriteriaConfig.education.label, minimumValue: '', maximumValue: '', relevantField: '' },
    { criteria: screeningCriteriaConfig.experience.label, minimumValue: '', maximumValue: '' },
  ],
  questionnaire: [{ question: '', idealAnswer: '', requireIdealAnswer: false }],
  applicationDeadline: '',
  aiScreeningEnabled: true,
  pipelineTemplateId: '',
  departmentId: '',
  status: 'open',
  interviewAvailability: {
    startDate: '',
    endDate: '',
    startTime: '10:00',
    endTime: '17:00',
    notes: '',
  },
};

export default function Requisitions() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDelete = canDeleteRecords(user); // only owners and admins may delete jobs
  const canManage = canManageRequisitions(user); // owner, admin, hiring manager, recruiter
  const location = useLocation();
  const { id: editId } = useParams();
  const [searchParams] = useSearchParams();
  const isCreatePage = location.pathname === '/requisitions/new';
  const isEditPage = Boolean(editId && location.pathname.includes('/edit'));
  const isFormPage = isCreatePage || isEditPage;

  const [requisitions, setRequisitions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [departmentFilter, setDepartmentFilter] = useState(() => searchParams.get('departmentId') || 'all');
  const [officeLocations, setOfficeLocations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [generatingField, setGeneratingField] = useState({});
  const [promptOpen, setPromptOpen] = useState({});
  const [fieldPrompts, setFieldPrompts] = useState({});
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [jobOpeningFilter, setJobOpeningFilter] = useState('all');
  const [page, setPage] = useState(1);

  function togglePromptBox(fieldType) {
    if (fieldType === 'jobDescription') {
      if (!form.title.trim()) {
        toast.error('Please enter a Job Title first so AI has context.');
        return;
      }
    } else if (fieldType === 'initialScreeningCriteria' || fieldType === 'questionnaire') {
      if (!stripHtml(form.jobDescription)) {
        toast.error('Please enter or generate a Job Description first so AI has context.');
        return;
      }
    }
    setPromptOpen((prev) => ({ ...prev, [fieldType]: !prev[fieldType] }));
  }

  async function handleRunFieldAiGeneration(fieldType) {
    if (fieldType === 'jobDescription') {
      if (!form.title.trim()) {
        toast.error('Please enter a Job Title first so AI has context.');
        return;
      }
    } else if (fieldType === 'initialScreeningCriteria' || fieldType === 'questionnaire') {
      if (!stripHtml(form.jobDescription)) {
        toast.error('Please enter or generate a Job Description first so AI has context.');
        return;
      }
    }

    const userInstruction = fieldPrompts[fieldType] || '';

    setGeneratingField((prev) => ({ ...prev, [fieldType]: true }));
    try {
      const res = await api.post('/requisitions/generate-field', {
        fieldType,
        title: form.title,
        jobDescription: form.jobDescription,
        prompt: userInstruction,
      });

      if (fieldType === 'questionnaire') {
        const questionsList = res.data.questions || [];
        setForm((f) => ({ ...f, questionnaire: questionsList.length ? questionsList : [{ question: '', idealAnswer: '' }] }));
      } else if (fieldType === 'initialScreeningCriteria') {
        const criteriaList = res.data.criteria || [];
        setForm((f) => ({ ...f, initialScreeningCriteria: criteriaList.length ? criteriaList : [{ criteria: '', requirement: '' }] }));
      } else {
        let content = (res.data.content || '').replace(/^```html\s*|^```\s*|```$/gi, '').trim();
        if (content && !/<[a-z][\s\S]*>/i.test(content)) {
          content = content.split(/\n\n+/).map((p) => `<p>${p.trim().replace(/\n/g, '<br/>')}</p>`).join('');
        }
        setForm((f) => ({ ...f, [fieldType]: content }));
      }
      setPromptOpen((prev) => ({ ...prev, [fieldType]: false }));
      toast.success('Generated content with AI!');
    } catch (err) {
      console.error(`Field generation error for ${fieldType}:`, err);
      toast.error(err?.response?.data?.message || `Failed to generate ${fieldType}.`);
    } finally {
      setGeneratingField((prev) => ({ ...prev, [fieldType]: false }));
    }
  }

  function handleCriteriaChange(index, field, value) {
    setForm((prev) => {
      const current = Array.isArray(prev.initialScreeningCriteria) ? prev.initialScreeningCriteria : [];
      const updated = current.map((c, i) => {
        if (i !== index) return c;
        const cObj = typeof c === 'string'
          ? { criteria: c, requirement: '' }
          : { ...c };
        cObj[field] = value;
        return cObj;
      });
      return { ...prev, initialScreeningCriteria: updated };
    });
  }

  function handleAddCriteria() {
    setForm((prev) => ({
      ...prev,
      initialScreeningCriteria: [...(Array.isArray(prev.initialScreeningCriteria) ? prev.initialScreeningCriteria : []), { criteria: '', requirement: '' }],
    }));
  }

  function handleRemoveCriteria(index) {
    setForm((prev) => {
      const current = Array.isArray(prev.initialScreeningCriteria) ? prev.initialScreeningCriteria : [];
      const updated = current.filter((_, i) => i !== index);
      return { ...prev, initialScreeningCriteria: updated.length ? updated : [{ criteria: '', requirement: '' }] };
    });
  }

  function handleQuestionChange(index, field, value) {
    setForm((prev) => {
      const current = Array.isArray(prev.questionnaire) ? prev.questionnaire : [];
      const updated = current.map((q, i) => {
        if (i !== index) return q;
        const qObj = typeof q === 'string'
          ? { question: q, idealAnswer: '' }
          : { ...q };
        qObj[field] = value;
        return qObj;
      });
      return { ...prev, questionnaire: updated };
    });
  }

  function handleAddQuestion() {
    setForm((prev) => ({
      ...prev,
      questionnaire: [...(Array.isArray(prev.questionnaire) ? prev.questionnaire : []), { question: '', idealAnswer: '', requireIdealAnswer: false }],
    }));
  }

  function handleRemoveQuestion(index) {
    setForm((prev) => {
      const current = Array.isArray(prev.questionnaire) ? prev.questionnaire : [];
      const updated = current.filter((_, i) => i !== index);
      return { ...prev, questionnaire: updated.length ? updated : [{ question: '', idealAnswer: '' }] };
    });
  }

  const [duplicatingId, setDuplicatingId] = useState(null);

  function copyApplyLink(reqId, e) {
    if (e) e.stopPropagation();
    const url = `${window.location.origin}/apply/${reqId}`;
    navigator.clipboard.writeText(url);
    toast.success('Candidate application link copied to clipboard!');
  }

  async function handleDuplicateRequisition(reqId, title, e) {
    if (e) e.stopPropagation();
    setDuplicatingId(reqId);
    try {
      await api.post(`/requisitions/${reqId}/duplicate`);
      toast.success(`Duplicated "${title}" successfully!`);
      loadRequisitions();
    } catch (error) {
      console.error('Failed to duplicate job opening:', error);
      toast.error(error?.response?.data?.message || 'Failed to duplicate job opening.');
    } finally {
      setDuplicatingId(null);
    }
  }

  const [deleteFor, setDeleteFor] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteRequisition() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/requisitions/${deleteFor._id}`);
      toast.success(res.data?.message || `Job Opening "${deleteFor.title}" deleted.`);
      setDeleteFor(null);
      loadRequisitions();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not delete job opening.');
    } finally {
      setDeleting(false);
    }
  }

  async function loadRequisitions() {
    setLoading(true);
    try {
      const res = await fetchRequisitionsList(statusFilter); // from the shared cache when it is still fresh
      setRequisitions(res.data.requisitions);
      setOfficeLocations(res.data.registeredOfficeLocations || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequisitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchPipelinesList().then((res) => setTemplates(res.data.templates));
  }, []);

  useEffect(() => {
    async function loadDepartments() {
      try {
        const res = await fetchDepartmentsList();
        const list = res.data.departments || [];
        setDepartments((prev) => {
          const combined = [...list];
          prev.forEach((p) => {
            if (p?._id && !combined.some((c) => String(c._id) === String(p._id))) {
              combined.push(p);
            }
          });
          return combined;
        });
      } catch (err) {
        console.error('Failed to load departments:', err);
      }
    }
    loadDepartments();
  }, []);

  useEffect(() => {
    if (isEditPage && editId) {
      async function loadEditReq() {
        try {
          const res = await api.get(`/requisitions/${editId}`);
          const r = res.data.requisition;
          if (r) {
            const rawDept = r.departmentId || r.department;
            const deptId = rawDept?._id ? String(rawDept._id) : (rawDept ? String(rawDept) : '');
            if (rawDept && rawDept._id && rawDept.name) {
              setDepartments((prev) => {
                if (prev.some((d) => String(d._id) === String(rawDept._id))) return prev;
                return [...prev, rawDept];
              });
            }
            setForm({
              title: r.title || '',
              departmentId: deptId,
              employmentType: r.employmentType || 'full_time',
              fullTimeDetails: r.fullTimeDetails || { workingHours: '' },
              partTimeDetails: r.partTimeDetails || { weeklyHours: '', workingHours: '' },
              contractDetails: r.contractDetails || { duration: '', workingHours: '', paymentRate: '' },
              internshipDetails: r.internshipDetails || { duration: '', paidStatus: 'paid', workingHours: '' },
              temporaryDetails: r.temporaryDetails || { startDate: '', endDate: '', workingHours: '' },
              workplaceType: r.workplaceType || 'remote',
              officeLocation: r.officeLocation || '',
              remoteRegion: r.remoteRegion || '',
              jobDescription: r.jobDescription || '',
              initialScreeningCriteria: Array.isArray(r.initialScreeningCriteria) && r.initialScreeningCriteria.length
                ? r.initialScreeningCriteria
                : EMPTY_FORM.initialScreeningCriteria,
              questionnaire: Array.isArray(r.questionnaire) && r.questionnaire.length
                ? r.questionnaire
                : EMPTY_FORM.questionnaire,
              applicationDeadline: r.applicationDeadline ? String(r.applicationDeadline).slice(0, 10) : '',
              aiScreeningEnabled: r.aiScreeningEnabled !== undefined ? r.aiScreeningEnabled : true,
              pipelineTemplateId: r.pipelineTemplateId?._id || r.pipelineTemplateId || '',
              status: r.status || 'open',
              interviewAvailability: r.interviewAvailability ? {
                startDate: r.interviewAvailability.startDate ? String(r.interviewAvailability.startDate).slice(0, 10) : '',
                endDate: r.interviewAvailability.endDate ? String(r.interviewAvailability.endDate).slice(0, 10) : '',
                startTime: r.interviewAvailability.startTime || '10:00',
                endTime: r.interviewAvailability.endTime || '17:00',
                notes: r.interviewAvailability.notes || '',
              } : EMPTY_FORM.interviewAvailability,
            });
          }
        } catch (err) {
          console.error('Failed to load job opening for edit:', err);
          toast.error('Could not load job opening details.');
        }
      }
      loadEditReq();
    }
  }, [isEditPage, editId]);

  // Layout owns the scrollable <main> element, so route navigation otherwise
  // preserves the list's scroll position and can open this form at its footer.
  useEffect(() => {
    if (isFormPage) document.querySelector('main')?.scrollTo({ top: 0 });
  }, [isFormPage]);

  async function handleCreate(e) {
    e.preventDefault();
    const normalizedTitle = normalizeJobTitle(form.title);

    if (!normalizedTitle) {
      toast.error('Job Opening Title is required.');
      return;
    }
    if (normalizedTitle.length < JOB_TITLE_MIN_LENGTH) {
      toast.error(`Job Opening Title must be at least ${JOB_TITLE_MIN_LENGTH} characters.`);
      return;
    }
    if (!form.employmentType) {
      toast.error('Employment Type is required.');
      return;
    }
    const employmentValidation = {
      full_time: [['fullTimeDetails', 'workingHours', 'Full-Time working hours']],
      part_time: [['partTimeDetails', 'weeklyHours', 'Part-Time weekly hours'], ['partTimeDetails', 'workingHours', 'Part-Time working hours']],
      contract: [['contractDetails', 'duration', 'Contract duration'], ['contractDetails', 'workingHours', 'Contract working hours'], ['contractDetails', 'paymentRate', 'Contract payment/rate']],
      internship: [['internshipDetails', 'duration', 'Internship duration'], ['internshipDetails', 'workingHours', 'Internship working hours']],
      temporary: [['temporaryDetails', 'startDate', 'Temporary role start date'], ['temporaryDetails', 'endDate', 'Temporary role end date'], ['temporaryDetails', 'workingHours', 'Temporary role working hours']],
    };
    for (const [group, field, label] of employmentValidation[form.employmentType] || []) {
      if (isBlankField(form[group]?.[field])) {
        toast.error(`${label} is required.`);
        return;
      }
    }
    if (form.employmentType === 'temporary' && form.temporaryDetails.endDate < form.temporaryDetails.startDate) {
      toast.error('Temporary role end date must be after the start date.');
      return;
    }
    if (!form.workplaceType) {
      toast.error('Work arrangement is required.');
      return;
    }
    if (form.workplaceType === 'onsite' && !officeLocations[0]) {
      toast.error('Add a registered office location before creating an onsite job opening.');
      return;
    }
    if (form.workplaceType === 'hybrid' && !form.officeLocation) {
      toast.error('Select an office location for a hybrid job opening.');
      return;
    }
    if (!stripHtml(form.jobDescription)) {
      toast.error('Job Description is required.');
      return;
    }

    // Validate Criteria items
    const criteriaItems = Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria : [];
    const educationCriteria = criteriaItems.find((item) => item?.criteria === screeningCriteriaConfig.education.label);
    if (isBlankField(educationCriteria?.relevantField)) {
      toast.error('Education relevant field or major is required.');
      return;
    }
    if (!educationCriteria?.minimumValue || !educationCriteria?.maximumValue) {
      toast.error('Select both minimum and maximum education qualifications.');
      return;
    }
    const educationOptions = screeningCriteriaConfig.education.options;
    if (educationOptions.indexOf(educationCriteria.minimumValue) > educationOptions.indexOf(educationCriteria.maximumValue)) {
      toast.error('Maximum education qualification must be equal to or higher than minimum qualification.');
      return;
    }
    const experienceCriteria = criteriaItems.find((item) => item?.criteria === screeningCriteriaConfig.experience.label);
    if (!experienceCriteria?.minimumValue || !experienceCriteria?.maximumValue) {
      toast.error('Select both minimum and maximum experience values.');
      return;
    }
    const options = screeningCriteriaConfig.experience.options;
    if (options.indexOf(experienceCriteria.minimumValue) > options.indexOf(experienceCriteria.maximumValue)) {
      toast.error('Maximum experience must be equal to or greater than minimum experience.');
      return;
    }

    // Validate Questionnaire items
    const questionnaireItems = Array.isArray(form.questionnaire) ? form.questionnaire : [];
    if (questionnaireItems.length === 0) {
      toast.error('At least one Application Questionnaire item is required.');
      return;
    }
    for (let i = 0; i < questionnaireItems.length; i++) {
      const item = typeof questionnaireItems[i] === 'string' ? { question: questionnaireItems[i], idealAnswer: '', requireIdealAnswer: false } : questionnaireItems[i];
      if (!item || !item.question || !item.question.trim()) {
        toast.error(`Question #${i + 1} text cannot be empty.`);
        return;
      }
      if (item.requireIdealAnswer && (!item.idealAnswer || !item.idealAnswer.trim())) {
        toast.error(`Question #${i + 1} ideal answer benchmark is required when checkbox is checked.`);
        return;
      }
    }

    if (!form.applicationDeadline) {
      toast.error('Application Deadline date is required.');
      return;
    }

    if (form.interviewAvailability?.startDate && form.interviewAvailability?.endDate) {
      if (form.interviewAvailability.endDate < form.interviewAvailability.startDate) {
        toast.error('Interview availability end date cannot be earlier than start date.');
        return;
      }
    }
    if (form.interviewAvailability?.startTime && form.interviewAvailability?.endTime) {
      const toMinutes = (t) => {
        if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      if (toMinutes(form.interviewAvailability.startTime) >= toMinutes(form.interviewAvailability.endTime)) {
        toast.error('Daily start time cannot be after or equal to end time.');
        return;
      }
    }

    if (!isEditPage && !form.pipelineTemplateId) {
      toast.error('Hiring Process Template is required.');
      return;
    }

    setCreating(true);
    try {
      if (isEditPage) {
        const updateRes = await api.patch(`/requisitions/${editId}`, { ...form, title: normalizedTitle });
        if (updateRes.data?.warning) toast(updateRes.data.warning, { icon: '⚠️' });
        toast.success('Job Opening updated successfully!');
        loadRequisitions();
        goBackToJob(navigate, location, editId); // back to the job page, not on top of the edit page
        return;
      }

      const createRes = await api.post('/requisitions', { ...form, title: normalizedTitle });
      const requisition = createRes.data.requisition;
      if (createRes.data.warning) toast(createRes.data.warning, { icon: '⚠️' });
      if (requisition.status !== 'closed') {
        toast.success('Job Opening created. Generating scorecard from the JD…');
        await api.post(`/requisitions/${requisition._id}/generate-scorecard`);
        toast.success('Scorecard generated — review and edit below.');
      } else {
        toast.success('Closed job opening created. Reopen it before generating a scorecard.');
      }
      setForm(EMPTY_FORM);
      loadRequisitions();
      navigate(`/requisitions/${requisition._id}`);

    } catch (error) {
      console.error(isEditPage ? 'Failed to update job opening:' : 'Failed to create job opening:', error);
      toast.error(
        error?.response?.data?.message ||
        (isEditPage ? 'Failed to update job opening.' : 'Failed to create job opening. Please check all fields.')
      );
    } finally {
      setCreating(false);
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => requisitions.filter((r) => {
    const matchesSearch = !query || (r.title || '').toLowerCase().includes(query);
    const matchesJobOpening = jobOpeningFilter === 'all' || r._id === jobOpeningFilter;
    const deptId = r.departmentId?._id || r.departmentId;
    const matchesDepartment = departmentFilter === 'all' || String(deptId || '') === String(departmentFilter);
    return matchesSearch && matchesJobOpening && matchesDepartment;
  }), [requisitions, query, jobOpeningFilter, departmentFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectedTemplate = templates.find((t) => t._id === form.pipelineTemplateId);
  const normalizedFormTitle = normalizeJobTitle(form.title);
  const duplicateActiveOpening = form.status === 'open' && normalizedFormTitle && requisitions.some((r) => (
    (!isEditPage || String(r._id) !== String(editId)) &&
    r.status === 'open' &&
    normalizeJobTitle(r.title || '').toLowerCase() === normalizedFormTitle.toLowerCase()
  ));

  return (
    <div>
      {!isFormPage && (
        <>
          {/* ---------- header ---------- */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
                  <Briefcase className="h-7 w-7 text-brand" />
                  Job Openings
                </h1>
                <p className="text-sm text-muted-foreground">
                  {loading ? 'Loading…' : `${requisitions.length} ${statusFilter ? STATUS_LABEL[statusFilter].toLowerCase() : 'total'}`}
                </p>
              </div>
            </div>
            {canManage && (
              <Button className="bg-brand text-white hover:bg-brand/90" onClick={() => navigate('/requisitions/new')}>
                <Plus />
                New Job Opening
              </Button>
            )}
          </div>

          {/* ---------- toolbar ---------- */}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by title…"
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setPage(1); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select
              value={statusFilter || 'all'}
              onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={departmentFilter}
              onValueChange={(v) => { setDepartmentFilter(v); setPage(1); }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={jobOpeningFilter} onValueChange={(value) => { setJobOpeningFilter(value); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="All job openings" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All job openings</SelectItem>
                {requisitions.map((requisition) => <SelectItem key={requisition._id} value={requisition._id}>{requisition.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* ---------- list ---------- */}
          <Card className="mt-4">
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-56" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  ))}
                </div>
              ) : requisitions.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {statusFilter ? `No ${STATUS_LABEL[statusFilter].toLowerCase()} job openings` : 'No job opening yet'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {statusFilter
                        ? 'Try a different status filter.'
                        : 'Paste a job description and Claude will draft the scorecard for you.'}
                    </p>
                  </div>
                  {!statusFilter && canManage && (
                    <Button className="bg-brand text-white hover:bg-brand/90" onClick={() => navigate('/requisitions/new')}>
                      <Plus />
                      New Job Opening
                    </Button>
                  )}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {query
                      ? `No matches for “${search.trim()}”`
                      : departmentFilter !== 'all'
                        ? `No job openings in ${departments.find((d) => String(d._id) === String(departmentFilter))?.name || 'this department'}`
                        : jobOpeningFilter !== 'all'
                          ? 'This job opening does not match the other filters'
                          : 'No matching job openings'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query
                      ? 'Try a different title, or change the filters.'
                      : 'Try a different filter, or clear the filters to see every job opening.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => { setSearch(''); setDepartmentFilter('all'); setJobOpeningFilter('all'); setPage(1); }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job Opening</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Candidates</TableHead>
                      <TableHead>Hiring Process</TableHead>
                      <TableHead className="hidden lg:table-cell">Created</TableHead>
                      <TableHead className="w-24 text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((r) => {
                      const stats = r.candidateStats || { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 };
                      const enabledStages = (r.stages || []).filter((s) => s.enabled).length;
                      return (
                        <TableRow
                          key={r._id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/requisitions/${r._id}`)}
                        >
                          <TableCell>
                            <span className="text-sm font-medium text-foreground">{r.title}</span>
                          </TableCell>

                          <TableCell className="text-sm text-muted-foreground">
                            {r.departmentId?.name || '—'}
                          </TableCell>

                          <TableCell>
                            <Badge variant="secondary" className={`font-normal ${STATUS_BADGE[r.status] || ''}`}>
                              {STATUS_LABEL[r.status] || r.status}
                            </Badge>
                          </TableCell>

                          <TableCell>
                            {stats.total === 0 ? (
                              <span className="text-xs text-muted-foreground">None yet</span>
                            ) : (
                              <div
                                className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted"
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); navigate(`/requisitions/${r._id}/candidates`); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); navigate(`/candidates?requisitionId=${r._id}`); } }}
                                title="View candidates for this job opening"
                              >
                                <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                  {stats.total}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {stats.inProgress > 0 ? `${stats.inProgress} in progress` : 'all decided'}
                                  {stats.HIRE > 0 ? ` · ${stats.HIRE} hire` : ''}
                                </span>
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="text-sm text-muted-foreground">
                            {r?.pipelineTemplateName}
                          </TableCell>

                          <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                            {formatDate(r.createdAt)}
                          </TableCell>

                          <TableCell onClick={(e) => e.stopPropagation()} className="w-24">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-500 hover:text-brand hover:bg-slate-100"
                                title="Copy Candidate Apply Link"
                                onClick={(e) => copyApplyLink(r._id, e)}
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-slate-500 hover:text-foreground hover:bg-slate-100"
                                    title="More options"
                                    disabled={duplicatingId === r._id}
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {canManage && (
                                    <>
                                      <DropdownMenuItem onClick={() => navigate(`/requisitions/${r._id}/edit`)}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit Job Opening
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={(e) => handleDuplicateRequisition(r._id, r.title, e)}>
                                        <Copy className="h-4 w-4 mr-2" />
                                        Duplicate Job Opening
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  <DropdownMenuItem onClick={(e) => copyApplyLink(r._id, e)}>
                                    <Link2 className="h-4 w-4 mr-2" />
                                    Copy Apply Link
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => navigate(`/requisitions/${r._id}`)}>
                                    <ChevronRight className="h-4 w-4 mr-2" />
                                    View Details
                                  </DropdownMenuItem>
                                  {canDelete && (
                                    <DropdownMenuItem
                                      onClick={(e) => { e.stopPropagation(); setDeleteFor(r); }}
                                      className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete Job Opening
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-foreground hover:bg-slate-100"
                                onClick={() => navigate(`/requisitions/${r._id}`)}
                                title="View Job Opening"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ---------- pagination ---------- */}
          {!loading && filtered.length > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</span>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          <AlertDialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {deleteFor?.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the Job Opening, cancels any active scheduled Google Calendar meeting events, deletes attached applications, scorecard, and files. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={(event) => { event.preventDefault(); handleDeleteRequisition(); }}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {deleting ? 'Deleting…' : 'Delete Job Opening'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </>
      )}

      {isFormPage && (
        <div className="mx-auto max-w-5xl space-y-6 pb-8">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => (isEditPage ? goBackToJob(navigate, location, editId) : navigate('/requisitions'))}
              aria-label="Back"
            >
              <ArrowLeft />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {isEditPage ? 'Edit Job Opening' : 'New Job Opening'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isEditPage
                  ? 'Update role details, department, screening requirements, and hiring process.'
                  : 'Add role details, department, screening requirements, and hiring process.'}
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="p-5 sm:p-7">

              <form noValidate onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label htmlFor="req-title">Title <span className="text-red-500">*</span></Label>
                    <Input
                      id="req-title" value={form.title} autoFocus
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="e.g. Sales Executive"
                    />
                    {duplicateActiveOpening && (
                      <p className="text-xs text-amber-700">
                        A job opening with this title already exists.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="req-dept">Department</Label>
                    <Select
                      key={`dept-select-${form.departmentId || 'none'}-${departments.length}`}
                      value={form.departmentId || 'none'}
                      onValueChange={(val) => setForm({ ...form, departmentId: val === 'none' ? '' : val })}
                    >
                      <SelectTrigger id="req-dept" className="w-full">
                        <SelectValue placeholder="Select Department">
                          {departments.find((d) => String(d._id) === String(form.departmentId))?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Department</SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d._id} value={String(d._id)}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="req-status">Status</Label>
                    <Select value={form.status || 'open'} onValueChange={(val) => setForm({ ...form, status: val })}>
                      <SelectTrigger id="req-status" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="req-employment-type">Employment Type <span className="text-red-500">*</span></Label>
                  <Select
                    value={form.employmentType || 'full_time'}
                    onValueChange={(val) => setForm({ ...form, employmentType: val })}
                  >
                    <SelectTrigger id="req-employment-type" className="w-full">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full-Time</SelectItem>
                      <SelectItem value="part_time">Part-Time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="internship">Internship</SelectItem>
                      <SelectItem value="temporary">Temporary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.employmentType === 'full_time' && (
                  <div className="rounded-md border p-3 space-y-3">
                    <p className="text-sm font-medium">Full-Time details</p>
                    <div className="space-y-1.5">
                      <Label htmlFor="full-time-working-hours">Working hours / shift <span className="text-red-500">*</span></Label>
                      <Input id="full-time-working-hours" value={form.fullTimeDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, fullTimeDetails: { ...form.fullTimeDetails, workingHours: e.target.value } })} placeholder="e.g. 9 AM–6 PM, Monday–Friday" />
                    </div>
                  </div>
                )}

                {form.employmentType === 'part_time' && (
                  <div className="rounded-md border p-3 space-y-3">
                    <p className="text-sm font-medium">Part-Time details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5"><Label htmlFor="part-time-weekly-hours">Weekly hours <span className="text-red-500">*</span></Label><Input id="part-time-weekly-hours" value={form.partTimeDetails?.weeklyHours || ''} onChange={(e) => setForm({ ...form, partTimeDetails: { ...form.partTimeDetails, weeklyHours: e.target.value } })} placeholder="e.g. 20 hours per week" /></div>
                      <div className="space-y-1.5"><Label htmlFor="part-time-working-hours">Working hours / shift <span className="text-red-500">*</span></Label><Input id="part-time-working-hours" value={form.partTimeDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, partTimeDetails: { ...form.partTimeDetails, workingHours: e.target.value } })} placeholder="e.g. 1 PM–5 PM, Mon–Fri" /></div>
                    </div>
                  </div>
                )}

                {form.employmentType === 'contract' && (
                  <div className="rounded-md border p-3 space-y-3">
                    <p className="text-sm font-medium">Contract details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5"><Label htmlFor="contract-duration">Duration <span className="text-red-500">*</span></Label><Input id="contract-duration" value={form.contractDetails?.duration || ''} onChange={(e) => setForm({ ...form, contractDetails: { ...form.contractDetails, duration: e.target.value } })} placeholder="e.g. 6 months" /></div>
                      <div className="space-y-1.5"><Label htmlFor="contract-working-hours">Working hours <span className="text-red-500">*</span></Label><Input id="contract-working-hours" value={form.contractDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, contractDetails: { ...form.contractDetails, workingHours: e.target.value } })} placeholder="e.g. 9 AM–6 PM" /></div>
                      <div className="space-y-1.5"><Label htmlFor="contract-payment-rate">Payment / rate <span className="text-red-500">*</span></Label><Input id="contract-payment-rate" value={form.contractDetails?.paymentRate || ''} onChange={(e) => setForm({ ...form, contractDetails: { ...form.contractDetails, paymentRate: e.target.value } })} placeholder="e.g. PKR 150,000/month" /></div>
                    </div>
                  </div>
                )}

                {form.employmentType === 'internship' && (
                  <div className="rounded-md border p-3 space-y-3">
                    <p className="text-sm font-medium">Internship details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="internship-duration">Duration <span className="text-red-500">*</span></Label>
                        <Input
                          id="internship-duration"
                          value={form.internshipDetails?.duration || ''}
                          onChange={(e) => setForm({ ...form, internshipDetails: { ...form.internshipDetails, duration: e.target.value } })}
                          placeholder="e.g. 3 months"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="internship-paid-status">Paid status</Label>
                        <Select
                          value={form.internshipDetails?.paidStatus || 'paid'}
                          onValueChange={(val) => setForm({ ...form, internshipDetails: { ...form.internshipDetails, paidStatus: val } })}
                        >
                          <SelectTrigger id="internship-paid-status"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="paid">Paid</SelectItem>
                            <SelectItem value="unpaid">Unpaid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="internship-working-hours">Working hours <span className="text-red-500">*</span></Label>
                        <Input
                          id="internship-working-hours"
                          value={form.internshipDetails?.workingHours || ''}
                          onChange={(e) => setForm({ ...form, internshipDetails: { ...form.internshipDetails, workingHours: e.target.value } })}
                          placeholder="e.g. 9 AM–5 PM, Mon–Fri"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {form.employmentType === 'temporary' && (
                  <div className="rounded-md border p-3 space-y-3">
                    <p className="text-sm font-medium">Temporary role details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5"><Label htmlFor="temporary-start-date">Start date <span className="text-red-500">*</span></Label><Input id="temporary-start-date" type="date" value={form.temporaryDetails?.startDate || ''} onChange={(e) => setForm({ ...form, temporaryDetails: { ...form.temporaryDetails, startDate: e.target.value } })} /></div>
                      <div className="space-y-1.5"><Label htmlFor="temporary-end-date">End date <span className="text-red-500">*</span></Label><Input id="temporary-end-date" type="date" value={form.temporaryDetails?.endDate || ''} onChange={(e) => setForm({ ...form, temporaryDetails: { ...form.temporaryDetails, endDate: e.target.value } })} /></div>
                      <div className="space-y-1.5"><Label htmlFor="temporary-working-hours">Working hours <span className="text-red-500">*</span></Label><Input id="temporary-working-hours" value={form.temporaryDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, temporaryDetails: { ...form.temporaryDetails, workingHours: e.target.value } })} placeholder="e.g. 9 AM–6 PM, Mon–Fri" /></div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                  <div className="space-y-1.5">
                    <Label htmlFor="req-workplace-type">Work arrangement <span className="text-red-500">*</span></Label>
                    <Select
                      value={form.workplaceType || 'remote'}
                      onValueChange={(val) => setForm((current) => ({
                        ...current,
                        workplaceType: val,
                        officeLocation: val === 'onsite' ? (officeLocations[0] || '') : (val === 'remote' ? '' : current.officeLocation),
                        remoteRegion: val === 'remote' ? current.remoteRegion : '',
                      }))}
                    >
                      <SelectTrigger id="req-workplace-type" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="onsite">Onsite</SelectItem>
                        <SelectItem value="hybrid">Hybrid</SelectItem>
                        <SelectItem value="remote">Remote</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.workplaceType === 'onsite' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="req-onsite-location">Office location</Label>
                      <Input
                        id="req-onsite-location"
                        value={officeLocations[0] || 'No registered office location configured'}
                        title={officeLocations[0] || 'No registered office location configured'}
                        className="truncate"
                        disabled
                      />
                      {!officeLocations[0] && (
                        <p className="text-xs text-muted-foreground">Set REGISTERED_OFFICE_LOCATIONS in the server .env file to enable onsite roles.</p>
                      )}
                    </div>
                  )}

                  {form.workplaceType === 'hybrid' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="req-hybrid-location">Office location <span className="text-red-500">*</span></Label>
                      <Select
                        value={form.officeLocation || undefined}
                        onValueChange={(val) => setForm({ ...form, officeLocation: val })}
                        disabled={officeLocations.length === 0}
                      >
                        <SelectTrigger id="req-hybrid-location" className="w-full">
                          <SelectValue placeholder={officeLocations.length ? 'Select an office...' : 'No registered office location configured'} />
                        </SelectTrigger>
                        <SelectContent>
                          {officeLocations.map((office) => <SelectItem key={office} value={office}>{office}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {officeLocations.length === 0 && (
                        <p className="text-xs text-muted-foreground">Set REGISTERED_OFFICE_LOCATIONS in the server .env file to enable hybrid roles.</p>
                      )}
                    </div>
                  )}

                  {form.workplaceType === 'remote' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="req-remote-region">Remote region or time zone <span className="text-muted-foreground">(optional)</span></Label>
                      <Input
                        id="req-remote-region"
                        value={form.remoteRegion || ''}
                        onChange={(e) => setForm({ ...form, remoteRegion: e.target.value })}
                        placeholder="e.g. Pakistan (PKT), EMEA, US Eastern"
                      />
                    </div>
                  )}

                </div>

                {/* Job Description with Generate AI button on right */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="req-jd">Job Description <span className="text-red-500">*</span></Label>
                    <button
                      type="button"
                      onClick={() => togglePromptBox('jobDescription')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      {promptOpen.jobDescription ? 'Close AI Prompt' : 'Generate with AI'}
                    </button>
                  </div>

                  {promptOpen.jobDescription && (
                    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                          Specify AI Instructions / Context:
                        </span>
                      </div>
                      <Input
                        placeholder="e.g. Senior role, 5+ yrs React, remote position, competitive pay & stock options..."
                        value={fieldPrompts.jobDescription || ''}
                        onChange={(e) => setFieldPrompts({ ...fieldPrompts, jobDescription: e.target.value })}
                        className="bg-white text-xs"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRunFieldAiGeneration('jobDescription');
                          }
                        }}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePromptBox('jobDescription')}
                          className="h-7 text-xs text-slate-600"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={generatingField.jobDescription}
                          onClick={() => handleRunFieldAiGeneration('jobDescription')}
                          className="bg-brand hover:bg-brand/90 text-white text-xs h-7 gap-1"
                        >
                          <Sparkles className="h-3 w-3" />
                          {generatingField.jobDescription ? 'Generating...' : 'Generate & Insert'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="bg-white rounded-md">
                    <ReactQuill
                      theme="snow"
                      value={form.jobDescription}
                      onChange={(val) => setForm((f) => ({ ...f, jobDescription: val }))}
                      modules={QUILL_MODULES}
                      placeholder="Paste or generate the full job description here…"
                    />
                  </div>
                </div>

                {/* Initial Screening Criteria */}
                <div className="hidden">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm font-semibold text-slate-900">Initial Screening Criteria</Label>
                        <span className="text-red-500 font-semibold">*</span>
                        <Badge variant="outline" className="text-[11px] font-normal text-slate-600 bg-slate-50">
                          {Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria.length : 0} {Array.isArray(form.initialScreeningCriteria) && form.initialScreeningCriteria.length === 1 ? 'item' : 'items'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Mandatory qualifications used by AI to evaluate candidate fit.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePromptBox('initialScreeningCriteria')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline pt-0.5"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      {promptOpen.initialScreeningCriteria ? 'Close AI Prompt' : 'Generate with AI'}
                    </button>
                  </div>

                  {promptOpen.initialScreeningCriteria && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                      <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                        AI Screening Criteria Instructions:
                      </span>
                      <Input
                        placeholder="e.g. Must have 3+ yrs React, Computer Science degree, sales background..."
                        value={fieldPrompts.initialScreeningCriteria || ''}
                        onChange={(e) => setFieldPrompts({ ...fieldPrompts, initialScreeningCriteria: e.target.value })}
                        className="bg-white text-xs"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRunFieldAiGeneration('initialScreeningCriteria');
                          }
                        }}
                      />
                      <div className="flex justify-end gap-2 pt-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePromptBox('initialScreeningCriteria')}
                          className="h-7 text-xs text-slate-600"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={generatingField.initialScreeningCriteria}
                          onClick={() => handleRunFieldAiGeneration('initialScreeningCriteria')}
                          className="bg-brand hover:bg-brand/90 text-white text-xs h-7 gap-1"
                        >
                          <Sparkles className="h-3 w-3" />
                          {generatingField.initialScreeningCriteria ? 'Generating...' : 'Generate & Insert'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {(Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria : [{ criteria: '', requirement: '' }]).map((c, idx) => {
                      const cObj = typeof c === 'string' ? { criteria: c, requirement: '' } : c;
                      return (
                        <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3 shadow-sm relative">
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                                {idx + 1}
                              </span>
                              <span className="text-xs font-semibold text-slate-700">Criteria Item #{idx + 1}</span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveCriteria(idx)}
                              title="Remove criteria"
                              className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs font-medium text-slate-700">
                                Category / Title <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                placeholder="e.g. Years of Experience, Education..."
                                value={cObj.criteria || ''}
                                onChange={(e) => handleCriteriaChange(idx, 'criteria', e.target.value)}
                                className="bg-white text-xs"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs font-medium text-slate-700">
                                Requirement Details <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                placeholder="e.g. Minimum 3+ years in B2B SaaS required..."
                                value={cObj.requirement || ''}
                                onChange={(e) => handleCriteriaChange(idx, 'requirement', e.target.value)}
                                className="bg-white text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddCriteria}
                    className="text-xs gap-1.5 border-dashed border-slate-300 text-slate-700 hover:text-brand hover:border-brand w-full sm:w-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Screening Criteria
                  </Button>
                </div>

                <div className="space-y-4 border-t pt-4">
                  <div>
                    <Label className="text-sm font-semibold text-slate-900">Initial Screening Criteria</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Fixed education and experience requirements used for AI resume screening.</p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
                    <p className="text-sm font-medium text-slate-800">Education</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1"><Label className="text-xs">Minimum qualification <span className="text-red-500">*</span></Label><Select value={form.initialScreeningCriteria.find((item) => item.criteria === screeningCriteriaConfig.education.label)?.minimumValue || undefined} onValueChange={(value) => setForm((current) => ({ ...current, initialScreeningCriteria: current.initialScreeningCriteria.map((item) => item.criteria === screeningCriteriaConfig.education.label ? { ...item, minimumValue: value } : item) }))}><SelectTrigger><SelectValue placeholder="Select minimum" /></SelectTrigger><SelectContent>{screeningCriteriaConfig.education.options.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Maximum qualification <span className="text-red-500">*</span></Label><Select value={form.initialScreeningCriteria.find((item) => item.criteria === screeningCriteriaConfig.education.label)?.maximumValue || undefined} onValueChange={(value) => setForm((current) => ({ ...current, initialScreeningCriteria: current.initialScreeningCriteria.map((item) => item.criteria === screeningCriteriaConfig.education.label ? { ...item, maximumValue: value } : item) }))}><SelectTrigger><SelectValue placeholder="Select maximum" /></SelectTrigger><SelectContent>{screeningCriteriaConfig.education.options.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Relevant field / major <span className="text-red-500">*</span></Label><Input placeholder="e.g. Computer Science, Software Engineering, HRM" value={form.initialScreeningCriteria.find((item) => item.criteria === screeningCriteriaConfig.education.label)?.relevantField || ''} onChange={(e) => setForm((current) => ({ ...current, initialScreeningCriteria: current.initialScreeningCriteria.map((item) => item.criteria === screeningCriteriaConfig.education.label ? { ...item, relevantField: e.target.value } : item) }))} /></div>
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id="allow-vu-ongoing"
                        checked={Boolean(form.initialScreeningCriteria.find((item) => item.criteria === screeningCriteriaConfig.education.label)?.allowVirtualUniversityOngoing)}
                        onCheckedChange={(checked) => setForm((current) => ({
                          ...current,
                          initialScreeningCriteria: current.initialScreeningCriteria.map((item) => (
                            item.criteria === screeningCriteriaConfig.education.label ? { ...item, allowVirtualUniversityOngoing: Boolean(checked) } : item
                          ))
                        }))}
                      />
                      <Label htmlFor="allow-vu-ongoing" className="text-xs text-slate-700 font-normal cursor-pointer">
                        Allow ongoing / in-progress degree for Virtual University (or distance learning) candidates
                      </Label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
                    <p className="text-sm font-medium text-slate-800">Experience</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Minimum experience <span className="text-red-500">*</span></Label>
                        <Select value={form.initialScreeningCriteria.find((item) => item.criteria === screeningCriteriaConfig.experience.label)?.minimumValue || undefined} onValueChange={(value) => setForm((current) => ({ ...current, initialScreeningCriteria: current.initialScreeningCriteria.map((item) => item.criteria === screeningCriteriaConfig.experience.label ? { ...item, minimumValue: value } : item) }))}>
                          <SelectTrigger><SelectValue placeholder="Select minimum" /></SelectTrigger><SelectContent>{screeningCriteriaConfig.experience.options.map((value) => <SelectItem key={value} value={value}>{value} years</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Maximum experience <span className="text-red-500">*</span></Label>
                        <Select value={form.initialScreeningCriteria.find((item) => item.criteria === screeningCriteriaConfig.experience.label)?.maximumValue || undefined} onValueChange={(value) => setForm((current) => ({ ...current, initialScreeningCriteria: current.initialScreeningCriteria.map((item) => item.criteria === screeningCriteriaConfig.experience.label ? { ...item, maximumValue: value } : item) }))}>
                          <SelectTrigger><SelectValue placeholder="Select maximum" /></SelectTrigger><SelectContent>{screeningCriteriaConfig.experience.options.map((value) => <SelectItem key={value} value={value}>{value} years</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Application Questionnaire */}
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm font-semibold text-slate-900">Application Questionnaire</Label>
                        <span className="text-red-500 font-semibold">*</span>
                        <Badge variant="outline" className="text-[11px] font-normal text-slate-600 bg-slate-50">
                          {Array.isArray(form.questionnaire) ? form.questionnaire.length : 0} {Array.isArray(form.questionnaire) && form.questionnaire.length === 1 ? 'question' : 'questions'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Questions asked on the public application form with ideal benchmarks for scoring.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePromptBox('questionnaire')}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline pt-0.5"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      {promptOpen.questionnaire ? 'Close AI Prompt' : 'Generate with AI'}
                    </button>
                  </div>

                  {promptOpen.questionnaire && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                      <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                        AI Questionnaire Instructions:
                      </span>
                      <Input
                        placeholder="e.g. Generate 5 technical React & System Design questions..."
                        value={fieldPrompts.questionnaire || ''}
                        onChange={(e) => setFieldPrompts({ ...fieldPrompts, questionnaire: e.target.value })}
                        className="bg-white text-xs"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRunFieldAiGeneration('questionnaire');
                          }
                        }}
                      />
                      <div className="flex justify-end gap-2 pt-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePromptBox('questionnaire')}
                          className="h-7 text-xs text-slate-600"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={generatingField.questionnaire}
                          onClick={() => handleRunFieldAiGeneration('questionnaire')}
                          className="bg-brand hover:bg-brand/90 text-white text-xs h-7 gap-1"
                        >
                          <Sparkles className="h-3 w-3" />
                          {generatingField.questionnaire ? 'Generating...' : 'Generate & Insert'}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {(Array.isArray(form.questionnaire) ? form.questionnaire : [{ question: '', idealAnswer: '' }]).map((q, idx) => {
                      const qObj = typeof q === 'string' ? { question: q, idealAnswer: '' } : q;
                      return (
                        <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3 shadow-sm relative">
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                                {idx + 1}
                              </span>
                              <span className="text-xs font-semibold text-slate-700">Question #{idx + 1}</span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveQuestion(idx)}
                              title="Remove question"
                              className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="space-y-2.5">
                            <div className="space-y-1">
                              <Label className="text-xs font-medium text-slate-700">
                                Question Text <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                placeholder={`e.g. What experience do you have with modern web frameworks?`}
                                value={qObj.question || ''}
                                onChange={(e) => handleQuestionChange(idx, 'question', e.target.value)}
                                className="bg-white text-xs"
                              />
                            </div>

                            <div className="flex items-center gap-2 pt-0.5 pb-0.5">
                              <Checkbox
                                id={`require-ideal-${idx}`}
                                checked={Boolean(qObj.requireIdealAnswer)}
                                onCheckedChange={(checked) => {
                                  const isChecked = Boolean(checked);
                                  handleQuestionChange(idx, 'requireIdealAnswer', isChecked);
                                  if (!isChecked) handleQuestionChange(idx, 'idealAnswer', '');
                                }}
                              />
                              <Label htmlFor={`require-ideal-${idx}`} className="text-xs text-slate-700 font-normal cursor-pointer">
                                Provide a custom Ideal Answer benchmark for this question
                              </Label>
                            </div>

                            {qObj.requireIdealAnswer ? (
                              <div className="space-y-1">
                                <Label className="text-xs font-medium text-slate-700">
                                  Ideal Answer Benchmark <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  placeholder="e.g. 3+ yrs experience building production apps with React/Next.js..."
                                  value={qObj.idealAnswer || ''}
                                  onChange={(e) => handleQuestionChange(idx, 'idealAnswer', e.target.value)}
                                  className="bg-white text-xs"
                                />
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500 italic pl-6">
                                AI will score candidates' responses for this question using the Job Description context.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddQuestion}
                    className="text-xs gap-1.5 border-dashed border-slate-300 text-slate-700 hover:text-brand hover:border-brand w-full sm:w-auto"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Question
                  </Button>
                </div>

                {/* Application Deadline & AI Screening Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="req-deadline">Application Deadline <span className="text-red-500">*</span></Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          id="req-deadline"
                          type="button"
                          variant="outline"
                          className="w-full justify-start font-normal text-left bg-white text-xs h-9"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          {form.applicationDeadline
                            ? dayjs(form.applicationDeadline).format('ddd, MMM D, YYYY')
                            : 'Pick an application deadline'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.applicationDeadline ? dayjs(form.applicationDeadline).toDate() : undefined}
                          onSelect={(date) => {
                            if (date) {
                              setForm((f) => ({ ...f, applicationDeadline: dayjs(date).format('YYYY-MM-DD') }));
                            }
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="flex items-center space-x-2 pt-6">
                    <Checkbox
                      id="req-ai-screening"
                      checked={form.aiScreeningEnabled}
                      onCheckedChange={(checked) => setForm({ ...form, aiScreeningEnabled: Boolean(checked) })}
                    />
                    <Label htmlFor="req-ai-screening" className="text-sm font-medium cursor-pointer">
                      Enable Automated AI Screening
                    </Label>
                  </div>
                </div>

                {/* Interview Availability Window */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3.5 shadow-sm">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-brand" />
                      <Label className="text-sm font-semibold text-slate-900">
                        HR Interview Availability
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select the dates and daily hours when you are available to interview candidates.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-700">
                        Start Date
                      </Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start font-normal text-left bg-white text-xs h-9">
                            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                            {form.interviewAvailability?.startDate
                              ? dayjs(form.interviewAvailability.startDate).format('ddd, MMM D, YYYY')
                              : 'Pick a start date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.interviewAvailability?.startDate ? dayjs(form.interviewAvailability.startDate).toDate() : undefined}
                            onSelect={(date) => {
                              if (date) {
                                setForm((f) => ({
                                  ...f,
                                  interviewAvailability: {
                                    ...f.interviewAvailability,
                                    startDate: dayjs(date).format('YYYY-MM-DD'),
                                  },
                                }));
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-700">
                        End Date
                      </Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start font-normal text-left bg-white text-xs h-9">
                            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                            {form.interviewAvailability?.endDate
                              ? dayjs(form.interviewAvailability.endDate).format('ddd, MMM D, YYYY')
                              : 'Pick an end date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.interviewAvailability?.endDate ? dayjs(form.interviewAvailability.endDate).toDate() : undefined}
                            disabled={form.interviewAvailability?.startDate ? { before: dayjs(form.interviewAvailability.startDate).toDate() } : undefined}
                            onSelect={(date) => {
                              if (date) {
                                setForm((f) => ({
                                  ...f,
                                  interviewAvailability: {
                                    ...f.interviewAvailability,
                                    endDate: dayjs(date).format('YYYY-MM-DD'),
                                  },
                                }));
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" /> Daily Start Time
                      </Label>
                      <TimePicker
                        value={form.interviewAvailability?.startTime || '10:00'}
                        onChange={(val) => setForm({
                          ...form,
                          interviewAvailability: {
                            ...form.interviewAvailability,
                            startTime: val,
                          },
                        })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" /> Daily End Time
                      </Label>
                      <TimePicker
                        value={form.interviewAvailability?.endTime || '17:00'}
                        onChange={(val) => setForm({
                          ...form,
                          interviewAvailability: {
                            ...form.interviewAvailability,
                            endTime: val,
                          },
                        })}
                      />
                    </div>
                  </div>

                  {(() => {
                    const toMinutes = (t) => {
                      if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
                      const [h, m] = t.split(':').map(Number);
                      return h * 60 + m;
                    };
                    const st = form.interviewAvailability?.startTime;
                    const et = form.interviewAvailability?.endTime;
                    if (st && et && toMinutes(st) >= toMinutes(et)) {
                      return (
                        <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
                          Daily start time cannot be after or equal to end time.
                        </p>
                      );
                    }
                    return null;
                  })()}

                  <div className="space-y-1.5">
                    <Label htmlFor="req-avail-notes" className="text-xs font-medium text-slate-700">
                      Notes (Optional)
                    </Label>
                    <Input
                      id="req-avail-notes"
                      placeholder="e.g. 30-minute virtual interviews via Google Meet."
                      value={form.interviewAvailability?.notes || ''}
                      onChange={(e) => setForm({
                        ...form,
                        interviewAvailability: {
                          ...form.interviewAvailability,
                          notes: e.target.value,
                        },
                      })}
                      className="bg-white text-xs"
                    />
                  </div>
                </div>

                {/* Pipeline template picker (only when creating a new job opening) */}
                {!isEditPage && (
                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="req-template">Hiring process template <span className="text-red-500">*</span></Label>
                    <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          id="req-template" type="button" variant="outline" role="combobox"
                          aria-expanded={templatePickerOpen}
                          className="w-full justify-between font-normal"
                        >
                          <span className={selectedTemplate ? '' : 'text-muted-foreground'}>
                            {selectedTemplate
                              ? `${selectedTemplate.name}${selectedTemplate.isDefault ? ' (default)' : ''}`
                              : 'Choose a hiring process…'}
                          </span>
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Type to filter…" />
                          <CommandList>
                            <CommandEmpty>No hiring process matches.</CommandEmpty>
                            <CommandGroup>
                              {templates.map((t) => {
                                const stageCount = (t.stages || []).filter((s) => s.enabled).length;
                                return (
                                  <CommandItem
                                    key={t._id}
                                    value={t.name}
                                    onSelect={() => {
                                      setForm((f) => ({ ...f, pipelineTemplateId: t._id }));
                                      setTemplatePickerOpen(false);
                                    }}
                                  >
                                    <Check className={form.pipelineTemplateId === t._id ? 'opacity-100' : 'opacity-0'} />
                                    <span className="flex-1">{t.name}{t.isDefault ? ' (default)' : ''}</span>
                                    <span className="text-xs text-muted-foreground">{stageCount} stages</span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedTemplate && (
                      <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
                    )}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => (isEditPage ? goBackToJob(navigate, location, editId) : navigate('/requisitions'))}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creating} className="bg-brand text-white hover:bg-brand/90">
                    {creating
                      ? (isEditPage ? 'Saving changes…' : 'Creating & generating…')
                      : (isEditPage ? 'Save Changes' : 'Create & generate scorecard')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
