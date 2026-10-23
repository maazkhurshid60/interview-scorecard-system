import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import api from '@/hooks/useApi';
import { Calendar as CalendarIcon, Clock, CheckCircle2, AlertCircle, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { TimePicker } from '@/components/ui/time-picker';
import logo from '../assets/logo.svg';

function formatStageLabel(label) {
  if (!label) return '';
  const KNOWN_STAGES = {
    initial_screening: 'Initial Screening',
    hr_screen: 'HR Screening',
    hr_interview: 'HR Interview',
    sales_simulation: 'Sales Simulation',
    technical_ops: 'Technical / Ops Interview',
    final_ceo: 'Final / CEO Interview',
    resume_screen: 'Resume Screening',
  };
  if (KNOWN_STAGES[label]) return KNOWN_STAGES[label];
  return String(label)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';

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
          size: 'flexible',
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

  return <div ref={containerRef} className="w-full" />;
}

export default function CandidateAvailability() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDate, setSelectedDate] = useState(() => dayjs().add(1, 'hour').startOf('hour').toDate());
  const [preferredDateStr, setPreferredDateStr] = useState(() => dayjs().add(1, 'hour').startOf('hour').format('YYYY-MM-DD'));
  const [startTime, setStartTime] = useState(() => dayjs().add(1, 'hour').startOf('hour').format('HH:mm'));
  const [endTime, setEndTime] = useState(() => dayjs().add(1, 'hour').startOf('hour').add(30, 'minute').format('HH:mm'));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [captcha, setCaptcha] = useState({ enabled: false, siteKey: '' });
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    async function fetchAvailabilityInfo() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/interviews/${id}/availability/public`);
        setData(res.data);
        setCaptcha(res.data.captcha || { enabled: false, siteKey: '' });
        if (res.data.candidateAvailability) {
          const avail = res.data.candidateAvailability;
          if (avail.preferredDate) {
            setPreferredDateStr(avail.preferredDate);
            if (typeof avail.preferredDate === 'string' && avail.preferredDate.includes('-')) {
              const [y, m, d] = avail.preferredDate.split('-').map(Number);
              setSelectedDate(new Date(y, m - 1, d, 12, 0, 0));
            }
          }
          setStartTime(avail.startTime || '10:00');
          setEndTime(avail.endTime || '10:30');
          setNotes(avail.notes || '');
        }
      } catch (err) {
        console.error('[CandidateAvailability] Load error:', err);
        setError(err?.response?.data?.message || 'Interview link expired or not found.');
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchAvailabilityInfo();
  }, [id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!preferredDateStr) {
      toast.error('Please select your preferred date.');
      return;
    }

    const timeToMinutes = (t) => {
      if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);

    if (startTime && endTime && endMins <= startMins) {
      toast.error('End time must be after start time.');
      return;
    }

    if (captcha.enabled && !captchaToken) {
      toast.error('Please complete the security check.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post(`/interviews/${id}/availability/public`, {
        preferredDate: preferredDateStr,
        startTime,
        endTime,
        notes,
        captchaToken,
      });
      setSubmitted(true);
      toast.success('Your availability has been submitted to the hiring team!');
    } catch (err) {
      console.error('[CandidateAvailability] Submit error:', err);
      setCaptchaToken('');
      setCaptchaResetKey((prev) => prev + 1);
      toast.error(err?.response?.data?.message || 'Could not submit availability.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl space-y-4">
          <Skeleton className="h-10 w-3/4 rounded-lg" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center border-red-200 shadow-lg">
          <CardHeader>
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-2" />
            <CardTitle className="text-xl font-bold text-slate-900">Link Unavailable</CardTitle>
            <CardDescription className="text-slate-600 text-sm mt-1">
              {error || 'This interview availability link is no longer valid or active.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/60 font-sans text-slate-900">
      <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <img src={logo} alt="OWNERS TALENT" className="h-8 w-auto object-contain" />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        {submitted ? (
          <Card className="shadow-md border-green-200 text-center">
            <CardHeader className="pt-8 pb-4">
              <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto mb-3" />
              <CardTitle className="text-2xl font-bold text-slate-900">Availability Submitted!</CardTitle>
              <CardDescription className="text-slate-600 text-sm mt-1">
                Thank you, <span className="font-semibold text-slate-800">{data.candidateName}</span>. Your availability for the <span className="font-semibold text-slate-800">{formatStageLabel(data.stageLabel)}</span> stage has been sent to our recruitment team.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-8 space-y-4">
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 text-left text-sm space-y-1.5">
                <p><span className="font-medium text-slate-700">Position:</span> {data.requisitionTitle}</p>
                <p><span className="font-medium text-slate-700">Preferred Date:</span> {selectedDate ? dayjs(selectedDate).format('dddd, MMMM D, YYYY') : preferredDateStr}</p>
                {startTime && (
                  <p>
                    <span className="font-medium text-slate-700">Time Window:</span>{' '}
                    {(() => {
                      const formatTime = (t) => (t && t.includes(':') ? dayjs(`2000-01-01T${t}`).format('h:mm A') : t);
                      return endTime ? `${formatTime(startTime)} – ${formatTime(endTime)}` : formatTime(startTime);
                    })()}
                  </p>
                )}
                {notes && <p><span className="font-medium text-slate-700">Notes:</span> {notes}</p>}
              </div>
              <p className="text-xs text-slate-500">
                Our HR team will review your availability and schedule the interview accordingly.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-md border-slate-200">
            <CardHeader className="border-b bg-white">
              <CardTitle className="text-xl font-bold text-slate-900">
                Select Interview Availability
              </CardTitle>
              <CardDescription className="text-sm">
                Position: <span className="font-semibold text-slate-800">{data.requisitionTitle}</span> · Stage: <span className="font-semibold text-brand">{formatStageLabel(data.stageLabel)}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Preferred Date <span className="text-red-500">*</span>
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start font-normal text-left">
                        <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                        {selectedDate ? dayjs(selectedDate).format('ddd, MMM D, YYYY') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => {
                          if (date) {
                            setSelectedDate(date);
                            setPreferredDateStr(dayjs(date).format('YYYY-MM-DD'));
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" /> Start Time
                      </Label>
                      <TimePicker
                        value={startTime}
                        onChange={(val) => setStartTime(val)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" /> End Time
                      </Label>
                      <TimePicker
                        value={endTime}
                        onChange={(val) => setEndTime(val)}
                      />
                    </div>
                  </div>
                  {(() => {
                    const toMins = (t) => {
                      if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
                      const [h, m] = t.split(':').map(Number);
                      return h * 60 + m;
                    };
                    if (startTime && endTime && toMins(endTime) <= toMins(startTime)) {
                      return (
                        <p className="text-xs font-medium text-red-500">
                          End time must be after start time.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="avail-notes" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Additional Notes / Flexible Windows (Optional)
                  </Label>
                  <Textarea
                    id="avail-notes"
                    placeholder="e.g., Free anytime after 2:00 PM on Thursday, or Friday morning."
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                {captcha.enabled && captcha.siteKey && (
                  <div className="pt-2 w-full flex justify-start">
                    <TurnstileCaptcha key={captchaResetKey} siteKey={captcha.siteKey} onToken={setCaptchaToken} />
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={submitting || (captcha.enabled && !captchaToken)}
                    className="w-full bg-brand hover:bg-brand/90 text-white gap-2 font-medium"
                  >
                    <Send className="h-4 w-4" />
                    {submitting ? 'Submitting Availability…' : 'Submit Availability'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
