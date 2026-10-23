import RichTextViewer from '../components/RichTextViewer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { ArrowLeft, ChevronDown, Calendar as CalendarIcon, Clock, Mail, Phone, Pencil } from 'lucide-react';
import api from '../hooks/useApi';
import { openStoredFile } from '../lib/fileAccess';
import { validatePdfFile } from '../lib/fileRules';
import { resolveZone, wallClockToInstant, pickedDay, formatInZone, defaultMeetingSlot } from '../lib/calendarTime';
import AlertBanner from '../components/AlertBanner';
import useRefreshWhile from '../hooks/useRefreshWhile';
import { isScreeningActive, isScreeningFailed } from '../lib/screening';
import PipelineStepper from '../components/PipelineStepper';
import { goBackToJob, openInterviewReplacing } from '../lib/interviewNavigation';
import ScoreReviewTable from '../components/ScoreReviewTable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { TimePicker } from '@/components/ui/time-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatDisposition } from '../utils/formatters';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_NUMBER_PATTERN = /^\d{11}$/;

function parseEmailList(value) {
  return [...new Set(value
    .split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];
}

export default function InterviewRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const openInterview = (interviewId) => openInterviewReplacing(navigate, location, interviewId);

  const [interview, setInterview] = useState(null);
  const [requisition, setRequisition] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [application, setApplication] = useState(null);
  const [stageLinks, setStageLinks] = useState({});
  const [siblingInterviews, setSiblingInterviews] = useState([]);
  const [loading, setLoading] = useState(true);

  const [meetingLinkInput, setMeetingLinkInput] = useState('');
  const [additionalInvitees, setAdditionalInvitees] = useState([]);
  const [additionalInviteesInput, setAdditionalInviteesInput] = useState('');
  const [selectedMeetingDate, setSelectedMeetingDate] = useState(() => dayjs().add(1, 'hour').startOf('hour').toDate());
  const [selectedStartTime, setSelectedStartTime] = useState(() => dayjs().add(1, 'hour').startOf('hour').format('HH:mm'));
  const [selectedEndTime, setSelectedEndTime] = useState(() => dayjs().add(1, 'hour').startOf('hour').add(30, 'minute').format('HH:mm'));
  // Meetings are picked, checked and shown in the CALENDAR's time zone (sent by the server),
  // not in the zone this computer is set to. Falls back to the computer's zone if the server sends none.
  const [calendarTimeZone, setCalendarTimeZone] = useState(null);
  const zone = resolveZone(calendarTimeZone);
  const slotDefaultedRef = useRef(false);
  const [meetingStartInput, setMeetingStartInput] = useState(() => `${dayjs().add(1, 'hour').startOf('hour').format('YYYY-MM-DDTHH:mm')}`);
  const [meetingEndInput, setMeetingEndInput] = useState(() => `${dayjs().add(1, 'hour').startOf('hour').add(30, 'minute').format('YYYY-MM-DDTHH:mm')}`);
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [confirmingConsent, setConfirmingConsent] = useState(false);
  const [fetchingTranscript, setFetchingTranscript] = useState(false);
  const [uploadingTranscript, setUploadingTranscript] = useState(false);
  const [uploadingArtifact, setUploadingArtifact] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputed, setRecomputed] = useState(null);
  const [openAttrs, setOpenAttrs] = useState(new Set());
  const [guideOpen, setGuideOpen] = useState(false);
  const [screeningInfoOpen, setScreeningInfoOpen] = useState(false);
  const [startingStage, setStartingStage] = useState(false);
  const [sendingMeetingEmail, setSendingMeetingEmail] = useState(false);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerFile, setOfferFile] = useState(null);
  const [showReupload, setShowReupload] = useState(false);

  const [passFailResult, setPassFailResult] = useState('');
  const [passFailSaving, setPassFailSaving] = useState(false);
  const [requestingAvailability, setRequestingAvailability] = useState(false);

  const [editCandidateOpen, setEditCandidateOpen] = useState(false);
  const [editCandidateForm, setEditCandidateForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [editCandidateResumeFile, setEditCandidateResumeFile] = useState(null);
  const [savingCandidate, setSavingCandidate] = useState(false);

  const load = useCallback(async () => {
    const { data: interviewData } = await api.get(`/interviews/${id}`);
    setInterview(interviewData.interview);
    setCalendarTimeZone(interviewData.calendarTimeZone || null);

    const [reqResponse, scorecardResponse] = await Promise.all([
      api.get(`/requisitions/${interviewData.interview.requisitionId}`),
      api.get(`/requisitions/${interviewData.interview.requisitionId}/scorecard`),
    ]);
    const reqData = reqResponse.data;
    setRequisition(reqData.requisition);
    setScorecard(scorecardResponse.data.scorecard || null);
    const appId = String(interviewData.interview.applicationId?._id || interviewData.interview.applicationId);
    const app = reqData.applications.find((a) => String(a._id) === appId);
    setApplication(app || null);

    const { data: siblingData } = await api.get('/interviews', { params: { applicationId: appId } });
    setSiblingInterviews(siblingData.interviews || []);
    setStageLinks(Object.fromEntries((siblingData.interviews || []).map((iv) => [iv.stageKey, iv._id])));

    return interviewData.interview;
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Once the calendar's zone is known, start the date/time pickers on the next full hour in that zone.
  useEffect(() => {
    if (!calendarTimeZone || slotDefaultedRef.current) return;
    slotDefaultedRef.current = true;
    const slot = defaultMeetingSlot(resolveZone(calendarTimeZone));
    setSelectedMeetingDate(slot.date);
    setSelectedStartTime(slot.startTime);
    setSelectedEndTime(slot.endTime);
  }, [calendarTimeZone]);

  // While the AI is still scoring this application in the background, refresh quietly until it finishes.
  useRefreshWhile(isScreeningActive(application), () => load());

  useEffect(() => {
    if (!id) return;
    const intervalId = setInterval(async () => {
      try {
        const { data } = await api.get(`/interviews/${id}`);
        if (data?.interview) {
          setInterview((prev) => {
            const prevAvail = JSON.stringify(prev?.candidateAvailability);
            const nextAvail = JSON.stringify(data.interview.candidateAvailability);
            if (
              prevAvail !== nextAvail ||
              prev?.calendarEventId !== data.interview.calendarEventId ||
              prev?.status !== data.interview.status ||
              prev?.transcriptStatus !== data.interview.transcriptStatus
            ) {
              return data.interview;
            }
            return prev;
          });
        }
      } catch {
        // Silently ignore background polling errors
      }
    }, 10000);

    return () => clearInterval(intervalId);
  }, [id]);

  const stageConfig = requisition?.stages.find((s) => s.key === interview?.stageKey);
  const candidate = application?.candidateId || application?.candidate || {};
  const rawStageAttributes = scorecard?.stages?.find((s) => s.stageKey === interview?.stageKey)?.attributes || [];
  const stageAttributes = (rawStageAttributes.length > 0 && (rawStageAttributes[0]?.question || rawStageAttributes[0]?.name))
    ? rawStageAttributes.map((attr) => ({
      ...attr,
      name: attr.name && !attr.name.startsWith('resume_screen') ? attr.name : 'Overall Resume & Qualification Evaluation',
    }))
    : (interview?.stageKey === 'hr_screen' || interview?.stageKey === 'hr_interview') && requisition?.questionnaire?.length > 0
      ? requisition.questionnaire.map((qItem, idx) => {
        const qText = typeof qItem === 'string' ? qItem : qItem.question;
        const ideal = typeof qItem === 'object' ? qItem.idealAnswer : '';
        return {
          attributeId: `${interview.stageKey}_question_${idx + 1}`,
          name: `Question ${idx + 1}`,
          question: qText,
          anchor5: ideal ? `Ideal answer benchmark: ${ideal}` : 'Fully addresses the question with a clear, relevant answer aligned with the Job Description requirements.',
          redFlags: ideal ? `Does not address or match the required ideal answer benchmark: "${ideal}".` : 'Does not answer the question, or provides an unclear or irrelevant response.',
        };
      })
      : interview?.stageKey === 'resume_screen'
        ? [{
          attributeId: 'resume_screen_1',
          name: 'Overall Resume & Qualification Evaluation',
          question: 'Assessing whether the candidate\'s CV meets the Job Description and Initial Screening Criteria.',
          anchor5: 'CV demonstrates strong alignment with all key experience, skills, and qualifications required for the role.',
          redFlags: 'CV lacks required core experience, qualifications, or key skills specified in the job posting.',
        }]
        : rawStageAttributes;

  const enabledStages = requisition?.stages?.filter((s) => s.enabled) || [];
  const isFinalStage = enabledStages.length > 0 && enabledStages[enabledStages.length - 1].key === interview?.stageKey;
  const currentStageProgress = application?.stageProgress?.find((p) => p.stageKey === interview?.stageKey);
  const isFailedStage = currentStageProgress?.status === 'failed' || currentStageProgress?.passed === false;

  useEffect(() => {
    setOpenAttrs(new Set(stageAttributes.length > 0 ? stageAttributes.map((a) => a.attributeId) : []));
    if (stageConfig?.inputType === 'manual_rubric' || stageConfig?.stageType === 'simulation' || stageConfig?.stageType === 'task_performance') {
      setGuideOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.stageKey, scorecard]);

  function toggleAttr(attributeId) {
    setOpenAttrs((prev) => {
      const next = new Set(prev);
      if (next.has(attributeId)) next.delete(attributeId);
      else next.add(attributeId);
      return next;
    });
  }

  async function handleCreateMeeting(useProvider) {
    setCreatingMeeting(true);
    try {
      let startDateObj, endDateObj;
      let localStartTime, localEndTime;
      if (useProvider) {
        const timeToMins = (t) => {
          if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
          const [h, m] = t.split(':').map(Number);
          return h * 60 + m;
        };
        if (selectedStartTime && selectedEndTime && timeToMins(selectedEndTime) <= timeToMins(selectedStartTime)) {
          toast.error('Meeting end time must be after start time.');
          setCreatingMeeting(false);
          return;
        }

        // The day clicked in the picker plus the times chosen are wall-clock values in the
        // calendar's zone; turn them into the real moments (the same on any computer).
        const day = pickedDay(selectedMeetingDate);
        const startHHmm = selectedStartTime || '10:00';
        const endHHmm = selectedEndTime || '10:30';
        startDateObj = wallClockToInstant(day, startHHmm, zone);
        endDateObj = wallClockToInstant(day, endHHmm, zone);
        localStartTime = `${day}T${startHHmm}:00`;
        localEndTime = `${day}T${endHHmm}:00`;
      }

      const pendingInvitees = parseEmailList(additionalInviteesInput);
      const invalidEmail = pendingInvitees.find((email) => !EMAIL_PATTERN.test(email));
      if (useProvider && invalidEmail) {
        toast.error(`Enter a valid invitee email address: ${invalidEmail}`);
        return;
      }
      const additionalAttendeeEmails = [...new Set([...additionalInvitees, ...pendingInvitees])];

      const body = useProvider
        ? {
          // Keep the date picked in the calendar separate from the UTC instant.
          // Google Calendar uses this local value with `timeZone`, so a timezone
          // conversion can never roll the event into the following day.
          localStartTime,
          localEndTime,
          meetingStart: startDateObj.toISOString(),
          meetingEnd: endDateObj.toISOString(),
          timeZone: zone,
          additionalAttendeeEmails,
        }
        : { meetingUri: meetingLinkInput.trim() };

      if (!useProvider && !body.meetingUri) {
        toast.error('Paste a meeting link first.');
        return;
      }
      if (useProvider && (!selectedStartTime || !selectedEndTime)) {
        toast.error('Choose the meeting start and end time first.');
        return;
      }
      if (useProvider && startDateObj.getTime() < Date.now() - 2 * 60 * 1000) {
        toast.error('Meeting start time is in the past. Please select a future date and time.');
        return;
      }
      if (useProvider && endDateObj.getTime() - startDateObj.getTime() > 60 * 60 * 1000) {
        toast.error('Interview duration cannot be longer than 1 hour.');
        return;
      }
      const res = await api.post(`/interviews/${id}/meeting`, body);
      setInterview(res.data.interview);
      setMeetingLinkInput('');
      setAdditionalInvitees([]);
      setAdditionalInviteesInput('');
      if (res.data.emailQueued) {
        toast.success('Meeting set. The candidate is being emailed.');
      } else {
        toast.success('Meeting set.');
        toast.error(res.data.emailReason || 'Could not email the candidate.');
      }
      reportHostEmailFailure(res.data);
    } finally {
      setCreatingMeeting(false);
    }
  }

  /** The server queues the Calendar host's notification; tell the user if it could not be queued. */
  function reportHostEmailFailure(result) {
    if (result?.hostEmailQueued !== false) return;
    toast.error(`Host email could not be sent: ${result.hostEmailReason || 'Email delivery is not configured.'}`);
  }

  function copyCandidateContact(value, label) {
    navigator.clipboard.writeText(value)
      .then(() => toast.success(`${label} copied.`))
      .catch(() => toast.error(`Could not copy the ${label.toLowerCase()}.`));
  }

  function addAdditionalInvitees(value) {
    const emails = parseEmailList(value);
    const invalidEmail = emails.find((email) => !EMAIL_PATTERN.test(email));
    if (invalidEmail) {
      toast.error(`Enter a valid invitee email address: ${invalidEmail}`);
      return false;
    }
    if (emails.length > 0) {
      setAdditionalInvitees((current) => [...new Set([...current, ...emails])]);
    }
    return true;
  }

  function commitAdditionalInvitee() {
    if (!additionalInviteesInput.trim()) return;
    if (addAdditionalInvitees(additionalInviteesInput)) setAdditionalInviteesInput('');
  }

  async function handleResendMeetingEmail() {
    setSendingMeetingEmail(true);
    try {
      const res = await api.post(`/interviews/${id}/send-meeting-email`, {}, { validateStatus: () => true });
      if (res.data?.queued) {
        toast.success('The email is being sent to the candidate.');
      } else {
        toast.error(res.data?.reason || res.data?.message || 'Could not send email.');
      }
    } finally {
      setSendingMeetingEmail(false);
    }
  }

  async function handleRequestAvailability() {
    setRequestingAvailability(true);
    try {
      const res = await api.post(`/interviews/${id}/request-availability`);
      if (res.data?.interview) {
        setInterview(res.data.interview);
      }

      if (res.data.queued) {
        toast.success(`Availability request email is being sent to ${res.data.candidateEmail || 'the candidate'}.`);
      } else {
        toast.error(res.data.emailReason || 'Could not send the availability request email. Check that email sending is configured.');
      }
    } catch (err) {
      console.error('[EmailNotifier] Error requesting availability:', err);
      toast.error(err?.response?.data?.message || 'Failed to send availability request.');
    } finally {
      setRequestingAvailability(false);
    }
  }

  function handleApplyCandidateAvailability() {
    if (!interview?.candidateAvailability?.preferredDate) return;
    const avail = interview.candidateAvailability;
    let preferredDateObj;
    if (typeof avail.preferredDate === 'string' && avail.preferredDate.includes('-')) {
      const [year, month, day] = avail.preferredDate.split('-').map(Number);
      preferredDateObj = new Date(year, month - 1, day, 12, 0, 0);
    } else {
      preferredDateObj = new Date(avail.preferredDate);
    }

    setSelectedMeetingDate(preferredDateObj);
    const startTimeStr = avail.startTime || '10:00';
    let endTimeStr = avail.endTime || '10:30';

    if (startTimeStr && endTimeStr && endTimeStr <= startTimeStr) {
      const [sh, sm] = startTimeStr.split(':').map(Number);
      const endMins = sh * 60 + sm + 30;
      const eh = Math.floor(endMins / 60) % 24;
      const em = endMins % 60;
      endTimeStr = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }

    setSelectedStartTime(startTimeStr);
    setSelectedEndTime(endTimeStr);
    const dateStr = dayjs(preferredDateObj).format('YYYY-MM-DD');
    setMeetingStartInput(`${dateStr}T${startTimeStr}`);
    setMeetingEndInput(`${dateStr}T${endTimeStr}`);
    toast.success("Meeting date and time set from candidate's preferred availability!");
  }

  async function handleStartNextStage(stageKey) {
    setStartingStage(true);
    try {
      const res = await api.post(
        '/interviews',
        { applicationId: application._id, stageKey },
        { validateStatus: () => true }
      );
      if (res.status === 201) {
        openInterview(res.data.interview._id);
      } else if (res.status === 409 && res.data?.interviewId) {
        // Duplicate interview — open the one that already exists. Out-of-order
        // stage attempts also return 409, but carry no interviewId; those fall
        // through so their "Stage X must be approved first" message is shown.
        openInterview(res.data.interviewId);
      } else {
        toast.error(res.data?.message || 'Could not start next stage.');
      }
    } finally {
      setStartingStage(false);
    }
  }

  async function handleCancelMeeting() {
    if (!window.confirm('Cancel this meeting? The link will be removed — you can create or paste a new one afterward.')) return;
    setCreatingMeeting(true);
    try {
      const res = await api.delete(`/interviews/${id}/meeting`, { validateStatus: () => true });
      if (res.status >= 400) {
        toast.error(res.data?.message || 'Could not cancel the meeting.');
        return;
      }
      setInterview(res.data.interview);
      toast.success('Meeting cancelled.');
      reportHostEmailFailure(res.data);
    } finally {
      setCreatingMeeting(false);
    }
  }

  async function handleConfirmConsent() {
    setConfirmingConsent(true);
    try {
      const res = await api.post(`/interviews/${id}/consent`);
      setInterview(res.data.interview);
      toast.success('Consent recorded.');
    } finally {
      setConfirmingConsent(false);
    }
  }

  async function handleFetchTranscript() {
    setFetchingTranscript(true);
    try {
      const res = await api.post(`/interviews/${id}/fetch-transcript`, {}, { validateStatus: () => true });
      if (res.status === 200) {
        setInterview(res.data.interview);
        toast.success('Transcript ready.');
      } else if (res.status === 202) {
        toast('Transcript is not ready yet. Google Meet processing can take up to 5 minutes after the meeting ends. Please try again shortly.', { icon: '⏳' });
      } else {
        toast.error(res.data?.message || 'Could not fetch transcript.');
      }
    } catch {
      toast.error('Could not fetch transcript. Please try again.');
    } finally {
      setFetchingTranscript(false);
    }
  }

  async function handleUploadTranscript(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTranscript(true);
    try {
      const body = new FormData();
      body.append('transcript', file);
      const res = await api.post(`/interviews/${id}/upload-transcript`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setInterview(res.data.interview);
      toast.success('Transcript uploaded.');
    } finally {
      setUploadingTranscript(false);
      e.target.value = '';
    }
  }

  async function handleUploadArtifact(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const problem = validatePdfFile(file, 'artifact');
    if (problem) {
      toast.error(problem);
      e.target.value = '';
      return;
    }
    setUploadingArtifact(true);
    try {
      const body = new FormData();
      body.append('artifact', file);
      const res = await api.post(`/interviews/${id}/upload-artifact`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setInterview(res.data.interview);
      toast.success('Artifact uploaded.');
    } finally {
      setUploadingArtifact(false);
      e.target.value = '';
    }
  }

  async function handleRunScoring() {
    setScoring(true);
    try {
      const res = await api.post(`/interviews/${id}/score`);
      setInterview(res.data.interview);
      if (res.data.message) toast.error(res.data.message);
      else toast.success('AI scoring complete — review below.');
    } finally {
      setScoring(false);
    }
  }

  async function handleRecompute() {
    setRecomputing(true);
    try {
      const res = await api.post(`/scoring/application/${application._id}/recompute`);
      setRecomputed(res.data.application);
      toast.success('Application results recomputed.');
    } finally {
      setRecomputing(false);
    }
  }

  async function handleSavePassFail() {
    if (!passFailResult) return;
    if (interview?.calendarEventId) {
      toast.error('Cancel the active Google Calendar meeting before saving this decision.');
      return;
    }

    const wasAlreadyApproved = interview?.status === 'approved';
    setPassFailSaving(true);

    try {
      const res = await api.patch(
        `/scoring/interview/${id}/pass-fail`,
        {
          passed: passFailResult === 'pass',
        },
        { validateStatus: () => true }
      );

      if (res.status >= 400) {
        toast.error(res.data?.message || 'Could not save decision.');
        return;
      }

      setInterview(res.data.interview);

      if (res.data.passed && res.data.nextInterviewId) {
        toast.success('Candidate passed this stage! Moving to next stage...');
        openInterview(res.data.nextInterviewId);
      } else {
        await load();
        toast.success(
          passFailResult === 'pass'
            ? 'Candidate passed this stage.'
            : 'Candidate failed this stage.'
        );
      }
    } finally {
      setPassFailSaving(false);
    }
  }

  async function handleSendOffer(e) {
    if (e) e.preventDefault();

    if (interview?.calendarEventId) {
      toast.error('Cancel the active Google Calendar meeting before completing this stage.');
      return;
    }

    if (!offerFile) {
      toast.error('Please select an offer letter PDF document before sending.');
      return;
    }

    if (!offerFile.name.toLowerCase().endsWith('.pdf') && offerFile.type !== 'application/pdf') {
      toast.error('Only PDF documents (.pdf) are supported for offer letters.');
      return;
    }

    if (offerFile.size > 5 * 1024 * 1024) {
      toast.error('Offer letter PDF file size must not exceed 5MB.');
      return;
    }

    setSendingOffer(true);
    try {
      const formData = new FormData();
      formData.append('offerLetter', offerFile);

      const res = await api.post(`/interviews/${interview._id}/send-offer`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });


      if (res.data.emailQueued) {
        toast.success('Offer letter uploaded, the candidate is being emailed, and the stage is approved!');
      } else {
        toast.success(`Offer stage approved! (${res.data.emailReason || 'Email not sent.'})`);
      }

      setInterview(res.data.interview);
      if (res.data.application) {
        setApplication(res.data.application);
      }
      setShowReupload(false);
      setOfferFile(null);

      if (res.data.nextInterviewId) {
        toast.success('Moving to next stage...');
        openInterview(res.data.nextInterviewId);
      } else {
        await load();
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to send offer.');
    } finally {
      setSendingOffer(false);
    }
  }


  function openEditCandidate() {
    const candName = candidate.name || application?.candidateName || '';
    const candEmail = candidate.email || application?.candidateEmail || '';
    const candPhone = candidate.phone || '';
    const candNotes = candidate.notes || '';
    setEditCandidateForm({ name: candName, email: candEmail, phone: candPhone, notes: candNotes });
    setEditCandidateResumeFile(null);
    setEditCandidateOpen(true);
  }

  async function handleSaveCandidate(e) {
    e.preventDefault();
    const candId = candidate._id || application?.candidateId?._id || application?.candidate?._id;
    if (!candId) {
      toast.error('Candidate ID not found.');
      return;
    }
    if (!editCandidateForm.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!editCandidateForm.email.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(editCandidateForm.email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (editCandidateForm.phone && !PHONE_NUMBER_PATTERN.test(editCandidateForm.phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }

    setSavingCandidate(true);
    try {
      const body = new FormData();
      body.append('name', editCandidateForm.name.trim());
      body.append('email', editCandidateForm.email.trim());
      body.append('phone', editCandidateForm.phone.trim());
      body.append('notes', editCandidateForm.notes);
      if (editCandidateResumeFile) body.append('resume', editCandidateResumeFile);

      await api.patch(`/candidates/${candId}`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${editCandidateForm.name.trim()}'s profile was updated.`);
      setEditCandidateOpen(false);
      setEditCandidateResumeFile(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not update candidate profile.');
    } finally {
      setSavingCandidate(false);
    }
  }

  const isTranscriptStage = stageConfig?.inputType === 'transcript' && stageConfig?.stageType !== 'simulation' && stageConfig?.stageType !== 'task_performance';
  const isTranscriptDisabled = stageConfig?.stageType === 'simulation' || stageConfig?.stageType === 'task_performance' || stageConfig?.inputType === 'manual_rubric';
  const showConsentCard = isTranscriptStage && !isTranscriptDisabled;
  const showMeetingCard = stageConfig?.inputType === 'transcript' || stageConfig?.stageType === 'simulation' || stageConfig?.stageType === 'task_performance' || stageConfig?.inputType === 'manual_rubric';

  const canScore = (showConsentCard ? interview?.consentObtained : true)
    && (stageConfig?.inputType === 'artifact' ? !!interview.artifactFileUrl : interview?.transcriptStatus === 'ready')
    && interview?.status !== 'approved';
  const hasActiveCalendarMeeting = Boolean(interview?.calendarEventId);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!interview || !requisition) return <div className="text-muted-foreground">Interview not found.</div>;

  return (
    <div>
      <button
        type="button"
        onClick={() => goBackToJob(navigate, location, requisition._id)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {requisition.title}
      </button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">
              {candidate.name || application?.candidateName || 'Candidate'} — {stageConfig?.label || interview.stageKey}
            </h1>
            {(candidate._id || application?.candidateId?._id || application?.candidate?._id) && (
              <button
                type="button"
                onClick={openEditCandidate}
                className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Edit candidate profile"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{requisition.title}</p>
          {(candidate.email || candidate.phone) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              {candidate.email && (
                <button type="button" onClick={() => copyCandidateContact(candidate.email, 'Email')} className="inline-flex items-center gap-1.5 hover:text-brand hover:underline" title="Copy email address">
                  <Mail className="h-4 w-4" />
                  {candidate.email}
                </button>
              )}
              {candidate.phone && (
                <button type="button" onClick={() => copyCandidateContact(candidate.phone, 'Phone number')} className="inline-flex items-center gap-1.5 hover:text-brand hover:underline" title="Copy phone number">
                  <Phone className="h-4 w-4" />
                  {candidate.phone}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isScreeningActive(application) && (
        <div className="mt-4">
          <AlertBanner type="info" message="The AI is scoring this application in the background. Scores will appear here shortly, so please wait before scoring by hand." />
        </div>
      )}
      {isScreeningFailed(application) && (
        <div className="mt-4">
          <AlertBanner type="warning" message="Automatic AI scoring could not finish for this application. You can score it by hand below." />
        </div>
      )}

      <Card className="mt-4">
        <CardContent className="pt-6">
          <PipelineStepper
            stages={requisition.stages}
            disabled={requisition.status !== 'open'}
            progress={Object.fromEntries(
              (requisition?.stages || []).map((stage) => {
                const p = (application?.stageProgress || []).find((pr) => pr.stageKey === stage.key);
                const sibIv = (siblingInterviews || []).find((iv) => iv.stageKey === stage.key);
                const interviewId = stageLinks[stage.key];
                const threshold = stage.passThreshold ?? 3;

                const isFailed =
                  p?.passed === false ||
                  p?.status === 'failed' ||
                  (sibIv?.stageAverage != null && sibIv.stageAverage < threshold) ||
                  (interview?.stageKey === stage.key && interview?.stageAverage != null && interview.stageAverage < threshold);

                const isPassed =
                  !isFailed &&
                  (p?.passed === true ||
                    p?.status === 'passed' ||
                    (p?.status === 'approved' && p?.passed !== false) ||
                    (sibIv?.status === 'approved' && sibIv?.stageAverage != null && sibIv.stageAverage >= threshold) ||
                    (interview?.stageKey === stage.key && interview?.status === 'approved' && interview?.stageAverage != null && interview.stageAverage >= threshold));

                let status = isFailed
                  ? 'failed'
                  : isPassed
                    ? 'passed'
                    : p?.status || (interviewId ? 'scheduled' : 'pending');

                return [stage.key, { stageKey: stage.key, status, passed: isFailed ? false : isPassed ? true : p?.passed }];
              })
            )}
            stageLinks={stageLinks}
            linkState={location.state}
            linkReplace
            currentStageKey={application?.currentStageKey}
            onStartStage={handleStartNextStage}
            startingStageKey={startingStage ? application?.currentStageKey : null}
          />
        </CardContent>
      </Card>

      {/* Requisition criteria shown only for the résumé screen. */}
      {(interview?.stageKey === 'resume_screen' || stageConfig?.stageType === 'resume_screen') &&
        (requisition?.jobDescription || requisition?.initialScreeningCriteria) && (
          <Card className="mt-4 overflow-hidden border-slate-200 bg-white shadow-sm">
            <CardHeader
              onClick={() => setScreeningInfoOpen((open) => !open)}
              className="cursor-pointer flex-row items-center justify-between space-y-0 py-4"
            >
              <CardTitle>Job Description & Initial Screening Criteria</CardTitle>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${screeningInfoOpen ? 'rotate-180' : ''}`} />
            </CardHeader>
            {screeningInfoOpen && <CardContent className="space-y-4 border-t pt-4 text-sm">
              {requisition.jobDescription && (
                <div>
                  <span className="font-semibold text-foreground">Job Description:</span>
                  <div className="mt-1 text-muted-foreground leading-relaxed rounded border bg-card p-2.5">
                    <RichTextViewer content={requisition.jobDescription} />
                  </div>
                </div>
              )}
              {requisition.initialScreeningCriteria && (
                <div>
                  <span className="font-semibold text-foreground">Initial Screening Criteria & Requirements:</span>
                  {Array.isArray(requisition.initialScreeningCriteria) ? (
                    <div className="mt-1 space-y-1.5 rounded border bg-card p-2.5">
                      {requisition.initialScreeningCriteria.map((item, idx) => {
                        const cName = typeof item === 'string' ? item : item.criteria;
                        const reqDetail = typeof item === 'object' ? item.requirement : '';
                        return (
                          <div key={idx} className="text-muted-foreground leading-relaxed">
                            <span className="font-medium text-foreground">• {cName}</span>
                            {reqDetail ? `: ${reqDetail}` : ''}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-muted-foreground leading-relaxed whitespace-pre-wrap rounded border bg-card p-2.5">
                      {requisition.initialScreeningCriteria}
                    </p>
                  )}
                </div>
              )}
            </CardContent>}
          </Card>
        )}

      {stageAttributes.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            onClick={() => setGuideOpen((v) => !v)}
            className="cursor-pointer flex-row items-center justify-between space-y-0 py-4"
          >
            <CardTitle>Interview Guide — {stageConfig?.label}</CardTitle>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
          </CardHeader>
          {guideOpen && (
            <CardContent className="space-y-3 border-t pt-4">
              {stageAttributes.map((attr) => {
                const isOpen = openAttrs.has(attr.attributeId);
                return (
                  <div key={attr.attributeId} className="rounded-md border border-border p-3">
                    <button
                      type="button"
                      onClick={() => toggleAttr(attr.attributeId)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {attr.name && !attr.name.includes('_question_') && !attr.name.startsWith('resume_screen')
                          ? attr.name
                          : attr.name?.startsWith('resume_screen') || attr.attributeId?.startsWith('resume_screen')
                            ? 'Overall Resume & Qualification Evaluation'
                            : attr.name?.includes('_question_') || attr.attributeId?.includes('_question_')
                              ? `Question ${String(attr.name || attr.attributeId).split('_question_')[1]}`
                              : attr.name || attr.attributeId}
                      </p>
                      <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="mt-3 space-y-2.5">
                        <p className="text-sm text-foreground">{attr.question}</p>
                        <div className="rounded-md border border-green-200 bg-green-50 p-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">What a 5 looks like</p>
                          <p className="mt-1 text-sm text-green-900">{attr.anchor5}</p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Red flags</p>
                          <p className="mt-1 text-sm text-amber-900">{attr.redFlags}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          )}
        </Card>
      )}

      {showMeetingCard && (
        <div className={`mt-6 grid gap-4 ${showConsentCard ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
          <Card>
            <CardHeader>
              <CardTitle>Meeting</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Candidate Availability Section */}
              {interview.candidateAvailability?.preferredDate ? (
                <div className="mb-4 rounded-lg border border-brand/30 bg-brand/5 p-3.5 text-sm">
                  <div className="flex items-center justify-between font-semibold text-slate-900 mb-1">
                    <span className="flex items-center gap-1.5 text-brand">
                      <CalendarIcon className="h-4 w-4" />
                      Candidate Availability Submitted
                    </span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {dayjs(interview.candidateAvailability.submittedAt).format('MMM D, h:mm A')}
                    </span>
                  </div>
                  <div className="mt-2 text-slate-800 space-y-1 text-xs sm:text-sm">
                    <p>
                      <strong className="text-slate-900">Date:</strong>{' '}
                      {(() => {
                        const d = interview.candidateAvailability.preferredDate;
                        if (typeof d === 'string' && d.includes('-')) {
                          const [y, m, day] = d.split('-').map(Number);
                          return dayjs(new Date(y, m - 1, day)).format('dddd, MMMM D, YYYY');
                        }
                        return dayjs(d).format('dddd, MMMM D, YYYY');
                      })()}
                    </p>
                    <p>
                      <strong className="text-slate-900">Time Window:</strong>{' '}
                      {(() => {
                        const st = interview.candidateAvailability.startTime;
                        const et = interview.candidateAvailability.endTime;
                        const formatTime = (t) => (t && t.includes(':') ? dayjs(`2000-01-01T${t}`).format('h:mm A') : t);
                        return st && et ? `${formatTime(st)} – ${formatTime(et)}` : st ? formatTime(st) : 'Flex';
                      })()}
                    </p>
                    {interview.candidateAvailability.notes && (
                      <p>
                        <strong className="text-slate-900">Candidate Notes:</strong>{' '}
                        {interview.candidateAvailability.notes}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!interview.meetingUri && (
                      <button
                        type="button"
                        onClick={handleApplyCandidateAvailability}
                        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 shadow-sm"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        Pre-fill & Use Candidate's Preferred Time
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRequestAvailability}
                      disabled={requestingAvailability}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-white px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {requestingAvailability ? 'Sending...' : 'Request Again'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Ask Candidate for Availability</p>
                    <p className="text-xs text-slate-500">Send an email link so candidate can choose their available date & time.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestAvailability}
                    disabled={requestingAvailability}
                    className="inline-flex items-center gap-1.5 shrink-0 rounded-md border border-brand/40 bg-white px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {requestingAvailability ? 'Sending...' : 'Send Request Email'}
                  </button>
                </div>
              )}

              {interview.meetingUri ? (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                  {interview.meetingStart && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-semibold text-slate-900 border-b pb-2.5">
                      <span className="flex items-center gap-1.5">
                        <CalendarIcon className="h-4 w-4 text-brand" />
                        {formatInZone(interview.meetingStart, zone, 'dddd, MMMM D, YYYY')}
                      </span>
                      <span className="flex items-center gap-1.5 text-slate-700">
                        <Clock className="h-4 w-4 text-slate-400" />
                        {formatInZone(interview.meetingStart, zone, 'h:mm A')}
                        {interview.meetingEnd ? ` – ${formatInZone(interview.meetingEnd, zone, 'h:mm A')}` : ''}
                        <span className="ml-1 text-xs font-normal text-slate-500">({zone})</span>
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Meeting Link</p>
                    <a href={interview.meetingUri} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-blue-600 hover:underline">
                      {interview.meetingUri}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground">({interview.provider === 'manual' ? 'Pasted link' : 'Google Meet'})</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button" onClick={handleResendMeetingEmail} disabled={sendingMeetingEmail}
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendingMeetingEmail ? 'Sending...' : 'Resend Meeting Email'}
                    </button>
                    <button
                      type="button" onClick={handleCancelMeeting} disabled={creatingMeeting}
                      className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {creatingMeeting ? 'Cancelling...' : 'Cancel Meeting'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Temporarily hidden: keep the manual-link workflow available in the API,
                      but only allow Google Calendar meetings from this screen for now.
                  <div className="flex gap-2">
                    <input
                      type="text" value={meetingLinkInput} onChange={(e) => setMeetingLinkInput(e.target.value)}
                      placeholder="Paste an existing meeting link..."
                      className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <button
                      type="button" onClick={() => handleCreateMeeting(false)} disabled={creatingMeeting}
                      className="rounded-md border border-brand/40 bg-white px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Use Link
                    </button>
                  </div>
                  */}
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Meeting Date
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start font-normal text-left">
                            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                            {selectedMeetingDate ? dayjs(selectedMeetingDate).format('ddd, MMM D, YYYY') : 'Pick a date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedMeetingDate}
                            onSelect={(date) => {
                              if (date) {
                                setSelectedMeetingDate(date);
                                const dateStr = dayjs(date).format('YYYY-MM-DD');
                                setMeetingStartInput(`${dateStr}T${selectedStartTime}`);
                                setMeetingEndInput(`${dateStr}T${selectedEndTime}`);
                              }
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-400" /> Start Time
                        </label>
                        <TimePicker
                          value={selectedStartTime}
                          onChange={(val) => {
                            setSelectedStartTime(val);
                            if (selectedMeetingDate) {
                              const dateStr = dayjs(selectedMeetingDate).format('YYYY-MM-DD');
                              setMeetingStartInput(`${dateStr}T${val}`);
                            }
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-400" /> End Time
                        </label>
                        <TimePicker
                          value={selectedEndTime}
                          onChange={(val) => {
                            setSelectedEndTime(val);
                            if (selectedMeetingDate) {
                              const dateStr = dayjs(selectedMeetingDate).format('YYYY-MM-DD');
                              setMeetingEndInput(`${dateStr}T${val}`);
                            }
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">All times are in {zone}.</p>
                    {(() => {
                      const toMins = (t) => {
                        if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
                        const [h, m] = t.split(':').map(Number);
                        return h * 60 + m;
                      };
                      if (selectedStartTime && selectedEndTime && toMins(selectedEndTime) <= toMins(selectedStartTime)) {
                        return (
                          <p className="text-xs font-medium text-red-500">
                            Meeting end time must be after start time.
                          </p>
                        );
                      }
                      return null;
                    })()}
                    <div className="space-y-1">
                      <label htmlFor="additional-invitees" className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Additional Invitees <span className="normal-case font-normal text-slate-400">(optional)</span>
                      </label>
                      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                        {additionalInvitees.map((email) => (
                          <span key={email} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-1 text-xs font-medium text-brand-dark">
                            {email}
                            <button
                              type="button"
                              aria-label={`Remove ${email}`}
                              onClick={() => setAdditionalInvitees((current) => current.filter((item) => item !== email))}
                              className="text-brand-dark/70 hover:text-brand-dark"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          id="additional-invitees"
                          value={additionalInviteesInput}
                          onChange={(event) => setAdditionalInviteesInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (['Enter', ',', ';'].includes(event.key)) {
                              event.preventDefault();
                              commitAdditionalInvitee();
                            }
                          }}
                          onPaste={(event) => {
                            const pasted = event.clipboardData.getData('text');
                            if (/[;,\n]/.test(pasted)) {
                              event.preventDefault();
                              if (addAdditionalInvitees(pasted)) setAdditionalInviteesInput('');
                            }
                          }}
                          onBlur={commitAdditionalInvitee}
                          placeholder={additionalInvitees.length ? 'Add another email…' : 'hod@company.com'}
                          className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Press comma, semicolon, or Enter after each email. Only valid addresses are added and sent with the Calendar invite.</p>
                    </div>
                  </div>
                  <button
                    type="button" onClick={() => handleCreateMeeting(true)} disabled={creatingMeeting}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingMeeting ? 'Creating...' : 'Create & Invite via Google Calendar'}
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {showConsentCard && (
            <Card>
              <CardHeader>
                <CardTitle>Consent</CardTitle>
              </CardHeader>
              <CardContent>
                {interview.consentObtained ? (
                  <p className="text-sm font-medium text-green-700">Candidate consent confirmed.</p>
                ) : (
                  <button
                    type="button" onClick={handleConfirmConsent} disabled={confirmingConsent}
                    className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmingConsent ? 'Confirming...' : 'Confirm Candidate Consent'}
                  </button>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Must be on before AI scoring can run.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {stageConfig?.inputType === 'artifact' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Artifact</CardTitle>
          </CardHeader>
          <CardContent>
            {interview.artifactFileUrl ? (
              <button type="button" onClick={() => openStoredFile('artifact', interview._id)} className="text-sm text-brand hover:underline">
                View uploaded artifact
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">No artifact uploaded yet.</p>
            )}
            <input
              type="file" accept="application/pdf,.pdf" onChange={handleUploadArtifact} disabled={uploadingArtifact}
              className="mt-2 cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-brand/40 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </CardContent>
        </Card>
      ) : stageConfig?.inputType === 'pass_fail' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Background Check</CardTitle>
          </CardHeader>

          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Review the background check and record the outcome for this stage.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPassFailResult('pass')}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${passFailResult === 'pass'
                  ? 'border-green-300 bg-green-50 text-slate-900'
                  : 'border-border bg-background text-slate-900 hover:bg-accent'
                  }`}
              >
                Pass
              </button>

              <button
                type="button"
                onClick={() => setPassFailResult('fail')}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${passFailResult === 'fail'
                  ? 'border-red-300 bg-red-50 text-slate-900'
                  : 'border-border bg-background text-slate-900 hover:bg-accent'
                  }`}
              >
                Fail
              </button>
              <button
                type="button"
                onClick={handleSavePassFail}
                disabled={!passFailResult || hasActiveCalendarMeeting || passFailSaving}
                className="ml-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {passFailSaving ? 'Saving...' : 'Save Decision'}
              </button>
            </div>

            {hasActiveCalendarMeeting && (
              <p className="mt-3 text-xs text-amber-700">Cancel the active Google Calendar meeting before saving this decision.</p>
            )}

            {interview.status === 'approved' && stageConfig?.inputType === 'pass_fail' && (
              <p className="mt-3 text-xs text-muted-foreground">
                Saved decision:{' '}
                <span className="font-medium text-foreground">
                  {interview.stageAverage >= stageConfig.passThreshold ? 'PASS' : 'FAIL'}
                </span>
              </p>
            )}

          </CardContent>
        </Card>
      ) : isTranscriptStage ? (
        <Card
          className={`mt-4 ${isTranscriptDisabled ? 'bg-slate-50/70 border-slate-200' : ''}`}
          title={isTranscriptDisabled ? 'Transcript is not needed for this step' : ''}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className={isTranscriptDisabled ? 'text-muted-foreground' : ''}>Transcript</CardTitle>
              {isTranscriptDisabled && (
                <span
                  className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-medium text-slate-600 border border-slate-300"
                  title="Transcript is not needed for this step"
                >
                  Not needed for this step
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isTranscriptDisabled && (
              <p className="mb-2 text-xs text-muted-foreground">
                Transcript is not needed for this step. Evaluate the candidate using the scorecard table below.
              </p>
            )}
            {interview.transcriptStatus === 'ready' ? (
              <p className="text-sm font-medium text-green-700">Transcript ready ({interview.transcriptText?.length || 0} chars).</p>
            ) : interview.transcriptStatus === 'pending' || fetchingTranscript ? (
              <p className="text-sm text-amber-600">Waiting for transcript... (auto-checking)</p>
            ) : (
              <p className="text-sm text-muted-foreground">No transcript yet.</p>
            )}
            <div
              className={`mt-2 flex flex-wrap items-center gap-2 ${isTranscriptDisabled ? 'opacity-50' : ''}`}
              title={isTranscriptDisabled ? 'Transcript is not needed for this step' : ''}
            >
              <button
                type="button"
                onClick={handleFetchTranscript}
                disabled={isTranscriptDisabled || fetchingTranscript || !interview.meetingUri}
                className="rounded-md border border-brand/40 bg-white px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
                title={isTranscriptDisabled ? 'Transcript is not needed for this step' : !interview.meetingUri ? 'Set a meeting first' : ''}
              >
                {fetchingTranscript ? 'Fetching...' : 'Fetch Transcript'}
              </button>
              <span className="text-xs text-muted-foreground">or</span>
              <input
                type="file"
                onChange={handleUploadTranscript}
                disabled={isTranscriptDisabled || uploadingTranscript}
                title={isTranscriptDisabled ? 'Transcript is not needed for this step' : ''}
                className="cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-brand/40 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </CardContent>
        </Card>
      ) : stageConfig?.inputType === 'status_only' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Job Offer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {interview.status === 'approved' && !showReupload ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                    Offer Stage Complete ✓
                  </span>
                </div>
                {interview.artifactFileUrl && (
                  <div>
                    <button type="button" onClick={() => openStoredFile('artifact', interview._id)} className="text-sm font-medium text-brand hover:underline">
                      View Uploaded Offer Letter
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  The offer stage is complete and candidate progress has been updated.
                </p>
                <div>
                  <button
                    type="button"
                    onClick={() => setShowReupload(true)}
                    className="rounded-md border border-brand/40 bg-white px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/5"
                  >
                    Replace / Re-upload Offer Letter
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {interview.status === 'approved'
                    ? 'Upload a new official Offer Letter document (PDF, Max 5MB). Re-sending will replace the existing file and email the updated letter to the candidate.'
                    : 'Upload the official Offer Letter document (PDF). Sending the offer will email the candidate.'}
                </p>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Select Offer Letter File (PDF, Max 5MB) <span className="text-red-500">*</span>:
                  </label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => {
                      const selected = e.target.files[0] || null;
                      if (selected && selected.size > 5 * 1024 * 1024) {
                        toast.error('File size exceeds 5MB limit.');
                        e.target.value = '';
                        setOfferFile(null);
                        return;
                      }
                      setOfferFile(selected);
                    }}
                    className="cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-brand/40 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/5"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendOffer}
                    disabled={sendingOffer || !offerFile || hasActiveCalendarMeeting}
                    className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendingOffer
                      ? 'Sending...'
                      : interview.status === 'approved'
                        ? 'Re-send Offer Letter'
                        : 'Send Offer & Complete Stage'}
                  </button>
                  {interview.status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowReupload(false);
                        setOfferFile(null);
                      }}
                      className="rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {hasActiveCalendarMeeting && (
                  <p className="text-xs text-amber-700">Cancel the active Google Calendar meeting before completing this stage.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : stageConfig?.inputType === 'manual_rubric' || stageConfig?.stageType === 'simulation' || stageConfig?.stageType === 'task_performance' ? null : (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">This stage type ("{stageConfig?.inputType}") isn't scored via AI on this screen.</p>
          </CardContent>
        </Card>
      )}

      {stageConfig?.inputType !== 'pass_fail' && stageConfig?.inputType !== 'status_only' && !isTranscriptDisabled && (
        <div className="mt-4">
          <button
            type="button" onClick={handleRunScoring} disabled={!canScore || scoring}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scoring ? 'Scoring...' : interview.scores?.length ? 'Re-run AI Scoring' : 'Run AI Scoring'}
          </button>
          {!canScore && interview.status !== 'approved' && (isTranscriptStage || stageConfig?.inputType === 'artifact') && (
            <p className="mt-1 text-xs text-muted-foreground">
              {stageConfig?.inputType === 'artifact'
                ? 'Requires an uploaded artifact first.'
                : showConsentCard
                  ? 'Requires consent + a ready transcript first.'
                  : 'Requires a ready transcript first.'}
            </p>
          )}
        </div>
      )}

      {(interview.scores?.length > 0 || isTranscriptDisabled) && (
        <div className="mt-4">
          <ScoreReviewTable
            interview={interview}
            attributes={stageAttributes}
            passThreshold={stageConfig?.passThreshold}
            meetingActive={hasActiveCalendarMeeting}
            onUpdated={(updatedInterview, stageAverage, passed, nextInterviewId, wasAlreadyApproved, updatedApplication) => {
              setInterview(updatedInterview);
              if (updatedApplication) {
                setApplication(updatedApplication);
              }
              if (updatedInterview.status === 'approved') {
                if (passed !== false && nextInterviewId) {
                  toast.success('Stage passed! Moving to next stage...');
                  openInterview(nextInterviewId);
                } else {
                  load();
                }
              }
            }}
          />
        </div>
      )}

      {interview.status === 'approved' && application && (isFinalStage || isFailedStage || application.currentStageKey === interview.stageKey) && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Application Results</CardTitle>
          </CardHeader>
          <CardContent>
            <button
              type="button" onClick={handleRecompute} disabled={recomputing}
              className="rounded-md border border-brand/40 bg-white px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recomputing ? 'Recomputing...' : 'Recompute Results'}
            </button>
            {recomputed && (
              <p className="mt-2 text-sm">
                Weighted total: <span className="font-semibold">{recomputed.weightedTotal ?? '—'}</span> · Gates passed:{' '}
                <span className="font-semibold">{String(recomputed.allGatesPassed)}</span> · Disposition:{' '}
                <span className="font-semibold">{formatDisposition(recomputed.disposition)}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={editCandidateOpen} onOpenChange={setEditCandidateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit candidate profile</DialogTitle>
            <DialogDescription>
              Update the candidate's profile details. Replacing the profile résumé does not change evidence already attached to interviews.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveCandidate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ir-edit-cand-name">Name <span className="text-red-500">*</span></Label>
                <Input
                  id="ir-edit-cand-name"
                  value={editCandidateForm.name}
                  autoFocus
                  onChange={(e) => setEditCandidateForm({ ...editCandidateForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ir-edit-cand-email">Email <span className="text-red-500">*</span></Label>
                <Input
                  id="ir-edit-cand-email"
                  type="email"
                  value={editCandidateForm.email}
                  onChange={(e) => setEditCandidateForm({ ...editCandidateForm, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ir-edit-cand-phone">Phone</Label>
                <Input
                  id="ir-edit-cand-phone"
                  value={editCandidateForm.phone}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  maxLength={11}
                  onChange={(e) => setEditCandidateForm({ ...editCandidateForm, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  placeholder="03001234567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ir-edit-cand-resume">Replace résumé <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="ir-edit-cand-resume"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setEditCandidateResumeFile(e.target.files?.[0] || null)}
                  className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-brand/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-brand hover:file:bg-brand/5"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ir-edit-cand-notes">Notes</Label>
              <Textarea
                id="ir-edit-cand-notes"
                rows={3}
                value={editCandidateForm.notes}
                onChange={(e) => setEditCandidateForm({ ...editCandidateForm, notes: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditCandidateOpen(false)} disabled={savingCandidate}>Cancel</Button>
              <Button type="submit" disabled={savingCandidate} className="bg-brand text-white hover:bg-brand/90">
                {savingCandidate ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
