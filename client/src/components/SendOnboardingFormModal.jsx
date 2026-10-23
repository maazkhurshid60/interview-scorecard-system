import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../hooks/useApi';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEFAULT_CLICKUP_FORM_URL = 'https://forms.clickup.com/9018918616/f/8ct3hpr-11198/JXG8EGK3RD18TR60TO';

export default function SendOnboardingFormModal({ open, onOpenChange, candidate, onSuccess }) {
  const [candidateEmail, setCandidateEmail] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [requisitionTitle, setRequisitionTitle] = useState('');
  const [onboardingUrl, setOnboardingUrl] = useState(DEFAULT_CLICKUP_FORM_URL);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (candidate) {
      setCandidateEmail(candidate.email || candidate.candidateEmail || candidate.candidateId?.email || '');
      setCandidateName(candidate.name || candidate.candidateName || candidate.candidateId?.name || '');
      setRequisitionTitle(candidate.requisitionTitle || candidate.jobTitle || candidate.requisition?.title || '');
      setOnboardingUrl(DEFAULT_CLICKUP_FORM_URL);
    }
  }, [candidate]);

  async function handleSendEmail(e) {
    e?.preventDefault();
    if (!candidateEmail) {
      toast.error('No candidate email address on file.');
      return;
    }

    setSending(true);
    const targetUrl = onboardingUrl.trim() || DEFAULT_CLICKUP_FORM_URL;
    const appId = candidate?.applicationId || candidate?._id;

    try {
      const res = await api.post('/candidates/send-onboarding-form', {
        candidateEmail,
        candidateName,
        onboardingUrl: targetUrl,
        applicationId: appId,
      });

      if (res.data?.queued) {
        toast.success(`Onboarding form email is being sent to ${candidateEmail}.`);
        onOpenChange(false);
        onSuccess?.();
        return;
      }

      toast.error(res.data?.emailReason || 'Could not send the onboarding form email. Check that email sending is configured.');
    } catch (err) {
      console.error('[OnboardingForm] Error sending onboarding form:', err);
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send onboarding form email.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send ClickUp Onboarding Form</DialogTitle>
          <DialogDescription>
            Send the candidate the official ClickUp onboarding form link by email.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSendEmail} className="space-y-4">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium text-foreground">{candidateName || 'Candidate'}</p>
            <p className="mt-1 text-muted-foreground">{requisitionTitle || 'Job opening'}</p>
            <p className="mt-1 break-all text-muted-foreground">{candidateEmail || 'No email address on file'}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="onboarding-url">Onboarding form URL (ClickUp)</Label>
              <button
                type="button"
                onClick={() => setOnboardingUrl(DEFAULT_CLICKUP_FORM_URL)}
                className="text-xs text-brand hover:underline font-medium"
              >
                Reset Default
              </button>
            </div>
            <Input
              id="onboarding-url"
              value={onboardingUrl}
              onChange={(e) => setOnboardingUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              The candidate receives an email with a direct link to complete their onboarding form.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={sending || !candidateEmail}
              className="bg-brand hover:bg-brand/90 text-white font-medium"
            >
              {sending ? 'Sending...' : 'Send Onboarding Form'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
