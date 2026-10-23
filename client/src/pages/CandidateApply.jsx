import RichTextViewer from '../components/RichTextViewer';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/hooks/useApi';
import {
  Briefcase, Calendar as CalendarIcon, FileText, Upload, AlertCircle, Sparkles, ArrowRight, MapPin, MessageCircle, Globe, ExternalLink, Users, Clock, CheckCircle2,
} from 'lucide-react';
import dayjs from 'dayjs';
import { TimePicker } from '@/components/ui/time-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import logo from '../assets/logo.svg';
import communityQrCode from '../assets/community-qr-code.png';

const formatDeadline = (date) => {
  const d = new Date(date);

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
};

const formatDisplayTime = (t) => {
  if (!t || typeof t !== 'string' || !t.includes(':')) return t || '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${period}`;
};

const validateCandidateAvailability = (hrAvail, date, startTime, endTime) => {
  if (!hrAvail || !hrAvail.startDate || !hrAvail.endDate) return null;
  if (!date) return 'Please select your preferred interview date.';
  const hrStartStr = String(hrAvail.startDate).slice(0, 10);
  const hrEndStr = String(hrAvail.endDate).slice(0, 10);
  if (date < hrStartStr || date > hrEndStr) {
    return `Interview date must be within ${hrStartStr} and ${hrEndStr}.`;
  }
  if (!startTime || !endTime) {
    return 'Please select preferred interview start and end time.';
  }
  const toMinutes = (t) => {
    if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    return 'Interview end time must be after start time.';
  }
  const hrStartTime = hrAvail.startTime || '10:00';
  const hrEndTime = hrAvail.endTime || '17:00';
  if (toMinutes(startTime) < toMinutes(hrStartTime) || toMinutes(endTime) > toMinutes(hrEndTime)) {
    return `Selected interview time must be within available hours (${formatDisplayTime(hrStartTime)} – ${formatDisplayTime(hrEndTime)}).`;
  }
  return null;
};

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';

function getEmploymentDetails(requisition) {
  const byType = {
    full_time: ['Full-Time details', [['Working hours', requisition.fullTimeDetails?.workingHours]]],
    part_time: ['Part-Time details', [['Weekly hours', requisition.partTimeDetails?.weeklyHours], ['Working hours', requisition.partTimeDetails?.workingHours]]],
    contract: ['Contract details', [['Duration', requisition.contractDetails?.duration], ['Working hours', requisition.contractDetails?.workingHours], ['Payment / rate', requisition.contractDetails?.paymentRate]]],
    internship: ['Internship details', [['Duration', requisition.internshipDetails?.duration], ['Status', requisition.internshipDetails?.paidStatus === 'paid' ? 'Paid' : requisition.internshipDetails?.paidStatus === 'unpaid' ? 'Unpaid' : ''], ['Working hours', requisition.internshipDetails?.workingHours]]],
    temporary: ['Temporary role details', [['Start date', requisition.temporaryDetails?.startDate ? String(requisition.temporaryDetails.startDate).slice(0, 10) : ''], ['End date', requisition.temporaryDetails?.endDate ? String(requisition.temporaryDetails.endDate).slice(0, 10) : ''], ['Working hours', requisition.temporaryDetails?.workingHours]]],
  };
  const details = byType[requisition.employmentType];
  if (!details) return null;
  const [title, items] = details;
  const populatedItems = items.filter(([, value]) => value);
  return populatedItems.length ? { title, items: populatedItems } : null;
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function TurnstileCaptcha({ siteKey, onToken }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let widgetId;
    let active = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!active || !turnstile || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => onToken(''));
    return () => {
      active = false;
      if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  return <div ref={containerRef} />;
}


export default function CandidateApply() {
  const { id } = useParams();

  const [requisition, setRequisition] = useState(null);
  const employmentDetails = requisition ? getEmploymentDetails(requisition) : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [step, setStep] = useState('jd'); // 'jd' | 'form' | 'success'

  // Application form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [opportunityOption, setOpportunityOption] = useState('30_days');
  const [opportunityCustom, setOpportunityCustom] = useState('');
  const [answers, setAnswers] = useState({});
  const [resumeFile, setResumeFile] = useState(null);
  const [candidateDate, setCandidateDate] = useState('');
  const [candidateStartTime, setCandidateStartTime] = useState('');
  const [candidateEndTime, setCandidateEndTime] = useState('');
  const [candidateNotes, setCandidateNotes] = useState('');
  const [formPart, setFormPart] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [captcha, setCaptcha] = useState({ enabled: false, siteKey: '' });
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    if (formPart !== 2) setCaptchaToken('');
  }, [formPart]);

  useEffect(() => {
    async function fetchPublicRequisition() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/requisitions/${id}/public`);
        setRequisition(res.data.requisition);
        setCaptcha(res.data.captcha || { enabled: false, siteKey: '' });
      } catch (err) {
        console.error('[CandidateApply] Failed to load job opening error:', err);
        const serverMsg = err?.response?.data?.message || err?.message;
        const statusCode = err?.response?.status;
        console.error(`[CandidateApply] Status: ${statusCode}, Message: ${serverMsg}`);
        setError(serverMsg || 'Job Opening not found or is closed.');
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchPublicRequisition();
  }, [id]);

  useEffect(() => {
    if (requisition?.interviewAvailability?.startDate) {
      const hrAvail = requisition.interviewAvailability;
      const startStr = hrAvail.startDate ? String(hrAvail.startDate).slice(0, 10) : '';
      if (startStr && !candidateDate) {
        setCandidateDate(startStr);
      }
      const hrStartTime = hrAvail.startTime || '10:00';
      const hrEndTime = hrAvail.endTime || '17:00';
      const toMinutes = (t) => {
        if (!t || typeof t !== 'string' || !t.includes(':')) return null;
        const [h, m] = t.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      if (!candidateStartTime || toMinutes(candidateStartTime) < toMinutes(hrStartTime) || toMinutes(candidateStartTime) > toMinutes(hrEndTime)) {
        setCandidateStartTime(hrStartTime);
      }
      if (!candidateEndTime || toMinutes(candidateEndTime) < toMinutes(hrStartTime) || toMinutes(candidateEndTime) > toMinutes(hrEndTime)) {
        setCandidateEndTime(hrEndTime);
      }
    }
  }, [requisition]);

  function handleAnswerChange(question, value) {
    setAnswers((prev) => ({ ...prev, [question]: value }));
  }

  function resetForm() {
    setName('');
    setEmail('');
    setPhone('');
    setAnswers({});
    setResumeFile(null);
    setCandidateDate('');
    setCandidateStartTime('');
    setCandidateEndTime('');
    setCandidateNotes('');
    setFormPart(1);
    setCaptchaToken('');
  }

  function handlePersonalContinue(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error('Name and Email are required.');
      return;
    }
    if (!/^\d{11}$/.test(phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }
    if (opportunityOption === 'custom' && !opportunityCustom.trim()) {
      toast.error('Please enter your custom opportunity availability duration.');
      return;
    }

    // Validate interview availability FIRST before resume upload so feedback matches visual order
    const availError = validateCandidateAvailability(
      requisition?.interviewAvailability,
      candidateDate,
      candidateStartTime,
      candidateEndTime
    );
    if (availError) {
      toast.error(availError);
      return;
    }

    if (!resumeFile) {
      toast.error('Please upload your CV / Resume file (PDF).');
      return;
    }
    const isPdf = resumeFile.type === 'application/pdf' || resumeFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast.error('Please upload your CV / Resume as a PDF file.');
      return;
    }
    if (resumeFile.size > 5 * 1024 * 1024) {
      toast.error('Your CV / Resume must be 5 MB or smaller.');
      return;
    }

    setFormPart(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error('Name and Email are required.');
      return;
    }

    if (!/^\d{11}$/.test(phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }

    // Validate interview availability FIRST before questionnaire and CV upload
    const availError = validateCandidateAvailability(
      requisition?.interviewAvailability,
      candidateDate,
      candidateStartTime,
      candidateEndTime
    );
    if (availError) {
      toast.error(availError);
      return;
    }

    const unansweredQuestionIndex = (requisition?.questionnaire || []).findIndex((question) => {
      const questionText = typeof question === 'string' ? question : question.question;
      return !answers[questionText]?.trim();
    });
    if (unansweredQuestionIndex !== -1) {
      toast.error(`Please answer screening question ${unansweredQuestionIndex + 1}.`);
      return;
    }

    if (!resumeFile) {
      toast.error('Please upload your CV / Resume file (PDF).');
      return;
    }
    const isPdf = resumeFile.type === 'application/pdf' || resumeFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast.error('Please upload your CV / Resume as a PDF file.');
      return;
    }
    if (resumeFile.size > 5 * 1024 * 1024) {
      toast.error('Your CV / Resume must be 5 MB or smaller.');
      return;
    }

    if (captcha.enabled && !captchaToken) {
      toast.error('Please complete the security check.');
      return;
    }

    setSubmitting(true);
    try {
      let durationText = '30 days';
      if (opportunityOption === '7_days') durationText = '7 days';
      else if (opportunityOption === '15_days') durationText = '15 days';
      else if (opportunityOption === '30_days') durationText = '30 days';
      else if (opportunityOption === '2_months') durationText = '2 months';
      else if (opportunityOption === 'custom') {
        if (!opportunityCustom.trim()) {
          toast.error('Please enter your custom opportunity availability duration.');
          return;
        }
        durationText = opportunityCustom.trim();
      }

      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('email', email.trim());
      formData.append('phone', phone.trim());
      formData.append('opportunityDuration', durationText);
      formData.append('questionnaireAnswers', JSON.stringify(answers));
      formData.append('resume', resumeFile);
      if (candidateDate) {
        formData.append('candidateAvailability', JSON.stringify({
          preferredDate: candidateDate,
          startTime: candidateStartTime,
          endTime: candidateEndTime,
          notes: candidateNotes.trim(),
        }));
      }
      if (captcha.enabled) formData.append('captchaToken', captchaToken);

      const res = await api.post(`/requisitions/${id}/apply`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(res.data);
      resetForm();
      setStep('success');
      toast.success('Application submitted successfully!');
    } catch (err) {
      console.error('[CandidateApply] Application submission failed:', err);
      if (err?.response?.data?.error === 'CAPTCHA_FAILED') {
        setCaptchaToken('');
        setCaptchaResetKey((key) => key + 1);
      }
      toast.error(err?.response?.data?.message || 'Failed to submit application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-12 w-3/4 rounded-lg" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !requisition) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full text-center border-red-200 shadow-lg">
          <CardHeader>
            <AlertCircle className="h-14 w-14 text-red-500 mx-auto mb-2" />
            <CardTitle className="text-2xl font-bold text-slate-900">Position Unavailable</CardTitle>
            <CardDescription className="text-slate-600 text-sm mt-1">
              This position is no longer accepting applications. It may have been filled, closed, or the application link is no longer valid.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2 pb-6">
            <p className="text-sm text-slate-500">
              Please check the link or contact the hiring team for help.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExpired = requisition.isExpired;

  return (
    <div className="min-h-screen bg-slate-50/60 font-sans text-slate-900">
      {/* Top Branding Header */}
      <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <img src={logo} alt="OWNERS TALENT" className="h-9 w-auto object-contain" />
          {requisition.applicationDeadline && (
            <Badge variant={isExpired ? 'destructive' : 'outline'} className="gap-1.5 py-1 px-3">
              <CalendarIcon className="h-3.5 w-3.5" />
              {isExpired ? 'Deadline Passed' : `Deadline: ${formatDeadline(requisition.applicationDeadline)}`}
            </Badge>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-3xl px-4 py-8">
        {step === 'jd' && (
          <Card className="shadow-md border-slate-200">
            <CardHeader className="border-b bg-white pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <Badge
                  className={
                    isExpired
                      ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-100'
                      : 'bg-brand/10 text-brand border-brand/20 hover:bg-brand/10'
                  }
                >
                  {isExpired ? 'Closed Position' : 'Open Position'}
                </Badge>
              </div>
              <CardTitle className="text-3xl font-bold text-slate-900 tracking-tight">
                {requisition.title}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500 flex flex-wrap items-center gap-2 mt-1">
                <span className="flex items-center gap-1">
                  <Briefcase className="h-4 w-4 text-slate-400" />
                  {
                    {
                      full_time: 'Full-Time',
                      part_time: 'Part-Time',
                      contract: 'Contract',
                      internship: 'Internship',
                      temporary: 'Temporary',
                    }[requisition.employmentType] || 'Full-Time'
                  }
                </span>
                {requisition.location && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      {requisition.location}
                    </span>
                  </>
                )}
                <span>·</span>
                <span>Red Star Technologies</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-brand" /> Job Description & Overview
                </h3>
                <div className="min-w-0 overflow-hidden text-slate-700 leading-relaxed text-sm bg-slate-50/70 p-4 rounded-lg border border-slate-100">
                  <RichTextViewer content={requisition.jobDescription} />
                </div>
              </div>

              {employmentDetails && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-base font-semibold text-slate-900 mb-2">{employmentDetails.title}</h3>
                  <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                    {employmentDetails.items.map(([label, value]) => (
                      <p key={label}><span className="font-medium">{label}:</span> {value}</p>
                    ))}
                  </div>
                </div>
              )}

              {isExpired ? (
                <div className="rounded-lg bg-red-50 p-4 border border-red-200 text-red-800 text-sm flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  Applications for this role closed on {formatDeadline(requisition.applicationDeadline)}.
                </div>
              ) : (
                <div className="pt-4 flex justify-end">
                  <Button
                    onClick={() => { setFormPart(1); setStep('form'); }}
                    className="bg-brand hover:bg-brand/90 text-white px-6 py-2.5 text-base font-medium shadow-sm gap-2"
                  >
                    Apply for this Position <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'form' && (
          <Card className="shadow-md border-slate-200">
            <CardHeader className="border-b bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl font-bold text-slate-900">
                    Application Form
                  </CardTitle>
                  <CardDescription className="text-sm">
                    Step {formPart} of 2 · Position: <span className="font-medium text-slate-800">{requisition.title}</span>
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setFormPart(1); setStep('jd'); }} className="text-slate-500">
                  Back to JD
                </Button>
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              <form onSubmit={formPart === 1 ? handlePersonalContinue : handleSubmit} className="space-y-6">
                {/* Contact Information */}
                {formPart === 1 && <div className="space-y-4">
                  <h3 className="text-base font-semibold text-slate-900 border-b pb-2">
                    Personal Information
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="candidate-name" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Full Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="candidate-name"
                        type="text"
                        placeholder="e.g. John Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="candidate-email" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Email Address <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="candidate-email"
                        type="email"
                        placeholder="john.doe@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="candidate-phone" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Phone Number <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="candidate-phone"
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]{11}"
                      maxLength={11}
                      placeholder="03001234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                      required
                    />
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="opportunity-duration" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Opportunity Availability <span className="text-red-500">*</span>
                    </Label>
                    <p className="text-xs text-slate-500">
                      How long will you remain open to this job opportunity?
                    </p>
                    <select
                      id="opportunity-duration"
                      value={opportunityOption}
                      onChange={(e) => setOpportunityOption(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="7_days">7 days</option>
                      <option value="15_days">15 days</option>
                      <option value="30_days">30 days</option>
                      <option value="2_months">2 months</option>
                      <option value="custom">Custom duration...</option>
                    </select>
                    {opportunityOption === 'custom' && (
                      <Input
                        type="text"
                        placeholder="e.g. 45 days or 3 months"
                        value={opportunityCustom}
                        onChange={(e) => setOpportunityCustom(e.target.value)}
                        className="mt-2 text-sm"
                        required
                      />
                    )}
                  </div>

                  {/* Candidate Interview Availability Selection */}
                  {requisition?.interviewAvailability?.startDate && requisition?.interviewAvailability?.endDate && (
                    <div className="rounded-xl border border-slate-200/90 bg-white p-5 space-y-4 shadow-sm">
                      {/* Section Header */}
                      <div className="border-b border-slate-100 pb-3 space-y-0.5">
                        <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                          If you are shortlisted, please select your interview availability <span className="text-red-500">*</span>
                        </h4>
                        <p className="text-xs text-slate-500">
                          Select your preferred date and time slot within the hiring team's available interview window.
                        </p>
                      </div>

                      {/* Available Window Info Box */}
                      <div className="rounded-lg bg-slate-50 border border-slate-200/70 p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                            <CalendarIcon className="h-3.5 w-3.5 text-brand" /> Available Window
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="bg-white border-slate-200 text-slate-800 text-xs font-medium px-2.5 py-0.5 shadow-none">
                              {dayjs(requisition.interviewAvailability.startDate).format('MMM D, YYYY')} – {dayjs(requisition.interviewAvailability.endDate).format('MMM D, YYYY')}
                            </Badge>
                            <Badge variant="outline" className="bg-white border-slate-200 text-slate-800 text-xs font-medium px-2.5 py-0.5 shadow-none">
                              {formatDisplayTime(requisition.interviewAvailability.startTime || '10:00')} – {formatDisplayTime(requisition.interviewAvailability.endTime || '17:00')}
                            </Badge>
                          </div>
                        </div>
                        {requisition.interviewAvailability.notes && (
                          <p className="text-xs text-slate-500 italic bg-white/70 border border-slate-100 rounded px-2.5 py-1">
                            Note: {requisition.interviewAvailability.notes}
                          </p>
                        )}
                      </div>

                      {/* Pickers Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Preferred Date */}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700 block">
                            Preferred Date <span className="text-red-500">*</span>
                          </Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-full justify-start font-normal text-left bg-white border-slate-200 text-sm h-10 shadow-sm hover:bg-slate-50"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
                                {candidateDate
                                  ? dayjs(candidateDate).format('ddd, MMM D, YYYY')
                                  : 'Pick a preferred date'}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={candidateDate ? dayjs(candidateDate).toDate() : undefined}
                                disabled={(date) => {
                                  const dStr = dayjs(date).format('YYYY-MM-DD');
                                  const startStr = String(requisition.interviewAvailability.startDate).slice(0, 10);
                                  const endStr = String(requisition.interviewAvailability.endDate).slice(0, 10);
                                  return dStr < startStr || dStr > endStr;
                                }}
                                onSelect={(date) => {
                                  if (date) {
                                    setCandidateDate(dayjs(date).format('YYYY-MM-DD'));
                                  }
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* Start and End Times */}
                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700 block">
                              Start Time <span className="text-red-500">*</span>
                            </Label>
                            <TimePicker
                              value={candidateStartTime || requisition.interviewAvailability.startTime || '10:00'}
                              onChange={(val) => setCandidateStartTime(val)}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700 block">
                              End Time <span className="text-red-500">*</span>
                            </Label>
                            <TimePicker
                              value={candidateEndTime || requisition.interviewAvailability.endTime || '17:00'}
                              onChange={(val) => setCandidateEndTime(val)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Real-time Status / Validation Feedback */}
                      {(() => {
                        const toMins = (t) => {
                          if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
                          const [h, m] = t.split(':').map(Number);
                          return h * 60 + m;
                        };
                        const hrStart = requisition.interviewAvailability.startTime || '10:00';
                        const hrEnd = requisition.interviewAvailability.endTime || '17:00';
                        if (candidateStartTime && candidateEndTime) {
                          if (toMins(candidateEndTime) <= toMins(candidateStartTime)) {
                            return (
                              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                <span>Daily start time cannot be after or equal to end time.</span>
                              </div>
                            );
                          }
                          if (toMins(candidateStartTime) < toMins(hrStart) || toMins(candidateEndTime) > toMins(hrEnd)) {
                            return (
                              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span>Selected time must be within available hours ({formatDisplayTime(hrStart)} – {formatDisplayTime(hrEnd)}).</span>
                              </div>
                            );
                          }
                        }
                        if (candidateDate && candidateStartTime && candidateEndTime) {
                          return (
                            <div className="text-xs text-emerald-800 bg-emerald-50/80 border border-emerald-200/80 rounded-lg p-2.5 flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <span>
                                Selected: <strong>{dayjs(candidateDate).format('dddd, MMM D, YYYY')}</strong> from <strong>{formatDisplayTime(candidateStartTime)}</strong> to <strong>{formatDisplayTime(candidateEndTime)}</strong>
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Availability Notes */}
                      <div className="space-y-1.5">
                        <Label htmlFor="candidate-avail-notes" className="text-xs font-semibold uppercase tracking-wider text-slate-700 block">
                          Availability Notes (Optional)
                        </Label>
                        <Input
                          id="candidate-avail-notes"
                          type="text"
                          placeholder=""
                          value={candidateNotes}
                          onChange={(e) => setCandidateNotes(e.target.value)}
                          className="bg-white text-sm h-10 border-slate-200 shadow-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>}

                {/* Questionnaire Questions */}
                {formPart === 2 && requisition.questionnaire && requisition.questionnaire.length > 0 && (
                  <div className="space-y-4 pt-2">
                    <h3 className="text-base font-semibold text-slate-900 border-b pb-2">
                      Application Questionnaire
                    </h3>
                    {requisition.questionnaire.map((q, idx) => {
                      const qText = typeof q === 'string' ? q : q.question;
                      return (
                        <div key={idx} className="space-y-1.5">
                          <Label htmlFor={`question-${idx}`} className="text-sm font-medium text-slate-800">
                            {idx + 1}. {qText} <span className="text-red-500">*</span>
                          </Label>
                          <Textarea
                            id={`question-${idx}`}
                            placeholder="Your answer..."
                            rows={3}
                            value={answers[qText] || ''}
                            onChange={(e) => handleAnswerChange(qText, e.target.value)}
                            required
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {formPart === 1 && <div className="space-y-2 pt-2">
                  <h3 className="text-base font-semibold text-slate-900 border-b pb-2">
                    Resume / CV Attachment <span className="text-red-500">*</span>
                  </h3>
                  <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center hover:border-brand/50 transition-colors bg-slate-50/50">
                    <Upload className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                    <Label htmlFor="resume-file" className="cursor-pointer text-sm font-medium text-brand hover:underline">
                      Upload CV / Resume (PDF, max 5 MB)
                    </Label>
                    <p className="text-xs text-slate-500 mt-1">PDF only, up to 5 MB</p>
                    <input
                      id="resume-file"
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => setResumeFile(e.target.files[0] || null)}
                      className="hidden"
                    />
                    {resumeFile && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-800 border shadow-sm">
                        <FileText className="h-4 w-4 text-brand" />
                        {resumeFile.name} ({(resumeFile.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    )}
                  </div>
                </div>}

                {formPart === 2 && captcha.enabled && (
                  <div>
                    <TurnstileCaptcha key={captchaResetKey} siteKey={captcha.siteKey} onToken={setCaptchaToken} />
                  </div>
                )}

                <div className="pt-4 flex justify-end gap-3">
                  {formPart === 1 ? (
                    <Button type="button" variant="outline" onClick={() => { setFormPart(1); setStep('jd'); }}>Cancel</Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setFormPart(1)}>Back</Button>
                  )}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-brand hover:bg-brand/90 text-white px-6"
                  >
                    {formPart === 1 ? 'Continue' : (submitting ? 'Submitting Application...' : 'Submit Application')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 'success' && (
          <Card className="shadow-xl shadow-slate-200/50 border border-slate-200/80 bg-white max-w-md mx-auto overflow-hidden rounded-3xl text-center transition-all">
            {/* Top decorative gradient bar */}
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />

            <CardContent className="p-5 sm:p-6 space-y-3.5 flex flex-col items-center">
              {/* Title & Description */}
              <div className="space-y-1 max-w-xs mx-auto">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Application Submitted!
                </h2>
                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
                  Thank you for applying. Join our official community channel to receive interview updates, role openings, and announcements.
                </p>
              </div>

              {/* Centered QR Code Card with Tap Pill */}
              <a
                href="https://www.whatsapp.com/channel/0029VbDvDlN2ZjCefkoday2w"
                target="_blank"
                rel="noopener noreferrer"
                className="group block p-2.5 sm:p-3 bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-lg hover:border-emerald-300 transition-all duration-300 hover:-translate-y-0.5"
                title="Click to open WhatsApp channel"
              >
                <img
                  src={communityQrCode}
                  alt="Red Star Technologies Careers WhatsApp Channel QR Code"
                  className="w-36 sm:w-40 h-auto object-contain rounded-xl block mx-auto bg-white transition-transform duration-300 group-hover:scale-[1.01]"
                />
                <div className="mt-2.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 rounded-full px-3 py-0.5 group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-200">
                  <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                  </svg>
                  <span>Scan or tap to join channel</span>
                </div>
              </a>

              {/* Social Channels Divider & Icons */}
              <div className="w-full pt-0.5 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-px bg-slate-200/80 flex-1" />
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Connect with Us
                  </span>
                  <div className="h-px bg-slate-200/80 flex-1" />
                </div>

                <div className="flex items-center justify-center gap-2 pt-0.5">
                  {/* WhatsApp */}
                  <a
                    href="https://www.whatsapp.com/channel/0029VbDvDlN2ZjCefkoday2w"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="WhatsApp"
                  >
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                    </svg>
                  </a>

                  {/* Facebook */}
                  <a
                    href="https://www.facebook.com/redstartechs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-[#1877F2] hover:text-white hover:border-[#1877F2] text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="Facebook"
                  >
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  </a>

                  {/* Instagram */}
                  <a
                    href="https://www.instagram.com/redstartechs/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-gradient-to-tr hover:from-[#F58529] hover:via-[#DD2A7B] hover:to-[#8134AF] hover:text-white hover:border-transparent text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="Instagram"
                  >
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                    </svg>
                  </a>

                  {/* LinkedIn */}
                  <a
                    href="https://www.linkedin.com/company/red-star-technologies/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-[#0A66C2] hover:text-white hover:border-[#0A66C2] text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="LinkedIn"
                  >
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                    </svg>
                  </a>

                  {/* YouTube */}
                  <a
                    href="https://www.youtube.com/@redstartechnologies"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-[#FF0000] hover:text-white hover:border-[#FF0000] text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="YouTube"
                  >
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                  </a>

                  {/* TikTok */}
                  <a
                    href="https://www.tiktok.com/@redstar.techs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-slate-900 hover:text-white hover:border-slate-900 text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="TikTok"
                  >
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
                    </svg>
                  </a>

                  {/* Website */}
                  <a
                    href="https://redstartechs.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 w-8 rounded-full bg-slate-50 border border-slate-200/80 hover:bg-brand hover:text-white hover:border-brand text-slate-600 flex items-center justify-center transition-all duration-200 shadow-sm hover:scale-105"
                    title="Website"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
