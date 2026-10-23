import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye } from 'lucide-react';
import api from '../hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimePicker } from '@/components/ui/time-picker';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const MAX_PDF_BYTES = 5 * 1024 * 1024;

function pdfUrlFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function emptyValues(jobTitle) {
  return { position: jobTitle || '', starting_salary: '', salary_after_probation: '', shift_start: '', shift_end: '' };
}

/**
 * "Send offer letter" window for a Hired candidate. The letter is either made from one
 * of the server's templates (pick a template, fill in the details, preview the PDF, send)
 * or is a PDF the person uploads themselves, as before.
 *
 * In template mode the server makes the PDF both for the preview and for sending, from the
 * typed values, so what is previewed is exactly what is sent. Sending stays disabled until
 * the current values have been previewed.
 *
 * @param {object} props
 * @param {object|null} props.application - The Hired application (window is open when set).
 * @param {string} [props.jobTitle]
 * @param {() => void} props.onClose
 * @param {() => void} props.onSent - Called after a successful send (reload the list).
 */
export default function OfferLetterDialog({ application, jobTitle, onClose, onSent }) {
  const open = !!application;
  const applicationId = application?._id;

  const [mode, setMode] = useState('template'); // 'template' | 'upload'
  const [templates, setTemplates] = useState(null); // null = loading
  const [templateKey, setTemplateKey] = useState('');
  const [values, setValues] = useState(() => emptyValues(jobTitle));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { url, key }
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  // A fresh window each time it opens for an application.
  useEffect(() => {
    if (!applicationId) return undefined;
    let cancelled = false;
    setTemplateKey('');
    setValues(emptyValues(jobTitle));
    setFile(null);
    setPreview(null);
    setTemplates(null);
    api.get('/scoring/offer-letter-templates')
      .then(({ data }) => {
        if (cancelled) return;
        const list = data.templates || [];
        setTemplates(list);
        setMode(list.some((t) => t.available) ? 'template' : 'upload');
      })
      .catch(() => {
        if (cancelled) return;
        setTemplates([]);
        setMode('upload');
      });
    return () => { cancelled = true; };
    // jobTitle is only the starting value for "Position", so it must not reset the form while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const template = useMemo(() => (templates || []).find((t) => t.key === templateKey) || null, [templates, templateKey]);
  const fieldValues = useMemo(() => {
    const picked = {};
    (template?.fields || []).forEach((f) => { picked[f.key] = values[f.key] ?? ''; });
    return picked;
  }, [template, values]);
  const currentKey = template ? JSON.stringify({ templateKey, fieldValues }) : '';
  const previewIsFresh = !!preview && preview.key === currentKey;
  const allFilled = !!template && template.fields.every((f) => String(fieldValues[f.key] ?? '').trim() !== '');

  // Free the preview file from memory when it is replaced or the window closes.
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  function setValue(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleClose() {
    if (sending || previewing) return;
    setPreview(null);
    onClose();
  }

  async function handlePreview() {
    if (!template || !allFilled) return;
    setPreviewing(true);
    try {
      const { data } = await api.post(`/scoring/application/${applicationId}/offer-letter-preview`, { templateKey, fields: fieldValues });
      setPreview({ url: pdfUrlFromBase64(data.pdfBase64), key: currentKey });
    } catch {
      // The API client already shows the server's message.
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    if (!applicationId) return;

    let request;
    if (mode === 'template') {
      if (!template || !previewIsFresh) {
        toast.error('Preview the letter first, then send it.');
        return;
      }
      request = api.post(`/scoring/application/${applicationId}/send-offer-letter`, { templateKey, fields: fieldValues });
    } else {
      if (!file) {
        toast.error('Choose the candidate\'s offer letter PDF first.');
        return;
      }
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
        toast.error('Only PDF offer letters can be uploaded.');
        return;
      }
      if (file.size > MAX_PDF_BYTES) {
        toast.error('The offer letter must be 5 MB or smaller.');
        return;
      }
      const formData = new FormData();
      formData.append('offerLetter', file);
      request = api.post(`/scoring/application/${applicationId}/send-offer-letter`, formData);
    }

    setSending(true);
    try {
      const response = await request;
      const { emailQueued, emailReason } = response.data;
      if (emailQueued) {
        toast.success('Offer letter saved. The candidate is being emailed.');
      } else {
        toast.error(emailReason || 'The offer letter was saved, but the email could not be sent.');
      }
      setPreview(null);
      onSent();
      onClose();
    } catch {
      // The API client already shows the server's message.
    } finally {
      setSending(false);
    }
  }

  const canUseTemplates = (templates || []).some((t) => t.available);
  const busy = sending || previewing;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send offer letter</DialogTitle>
          <DialogDescription>
            {mode === 'template'
              ? `Make the letter for ${application?.candidateId?.name || 'this candidate'} from a template, check the preview, then send it.`
              : `Upload a signed PDF for ${application?.candidateId?.name || 'this candidate'}. The candidate will receive it by email.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSend} className="space-y-4">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium text-foreground">{application?.candidateId?.name || 'Candidate'}</p>
            <p className="mt-1 text-muted-foreground">{jobTitle || 'Job opening'}</p>
            <p className="mt-1 break-all text-muted-foreground">{application?.candidateId?.email || 'No email address on file'}</p>
          </div>

          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="How to make the letter">
            <Button
              type="button"
              size="sm"
              variant={mode === 'template' ? 'default' : 'ghost'}
              className={mode === 'template' ? 'bg-brand text-white hover:bg-brand/90' : ''}
              aria-pressed={mode === 'template'}
              disabled={busy || !canUseTemplates}
              onClick={() => setMode('template')}
            >
              Use a template
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'upload' ? 'default' : 'ghost'}
              className={mode === 'upload' ? 'bg-brand text-white hover:bg-brand/90' : ''}
              aria-pressed={mode === 'upload'}
              disabled={busy}
              onClick={() => setMode('upload')}
            >
              Upload my own PDF
            </Button>
          </div>

          {templates === null && <p className="text-sm text-muted-foreground">Loading templates…</p>}

          {templates !== null && !canUseTemplates && (
            <p className="text-sm text-muted-foreground">
              Letter templates are not available on this server right now. You can upload a PDF instead.
            </p>
          )}

          {mode === 'template' && canUseTemplates && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Template</Label>
                <Select value={templateKey} onValueChange={setTemplateKey} disabled={busy}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.key} value={t.key} disabled={!t.available}>
                        {t.label}{t.available ? '' : ' (not set up on this server)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {template && <p className="text-xs text-muted-foreground">{template.description}</p>}
              </div>

              {template && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {template.fields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={`offer-${field.key}`}>{field.label} <span className="text-red-500">*</span></Label>
                      {field.type === 'time' ? (
                        // Starts empty: no time is chosen until hour, minute and AM/PM are picked.
                        <TimePicker allowEmpty value={values[field.key] || ''} onChange={(time) => setValue(field.key, time)} />
                      ) : (
                        <Input
                          id={`offer-${field.key}`}
                          value={values[field.key] || ''}
                          // Salary fields take digits only: anything else typed or pasted is dropped.
                          onChange={(e) => setValue(field.key, field.type === 'salary' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                          inputMode={field.type === 'salary' ? 'numeric' : 'text'}
                          pattern={field.type === 'salary' ? '[0-9]*' : undefined}
                          placeholder={field.type === 'salary' ? 'e.g. 85000' : ''}
                          maxLength={field.type === 'salary' ? 9 : 80}
                          disabled={busy}
                        />
                      )}
                      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                    </div>
                  ))}
                </div>
              )}

              {template && (
                <div className="space-y-2">
                  <Button type="button" variant="outline" onClick={handlePreview} disabled={!allFilled || busy}>
                    <Eye className="mr-2 h-4 w-4" />
                    {previewing ? 'Making the preview…' : previewIsFresh ? 'Refresh preview' : 'Preview letter'}
                  </Button>
                  {!allFilled && <p className="text-xs text-muted-foreground">Fill in every field to preview the letter.</p>}
                  {preview && !previewIsFresh && (
                    <p className="text-xs text-amber-700">You changed the details. Preview the letter again before sending.</p>
                  )}
                  {previewIsFresh && (
                    <iframe
                      title="Offer letter preview"
                      src={preview.url}
                      className="h-[55vh] w-full rounded-md border border-border"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'upload' && (
            <div className="space-y-1.5">
              <Label htmlFor="offer-letter-file">Offer letter (PDF)</Label>
              <Input
                id="offer-letter-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                disabled={busy}
                className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-brand/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-brand hover:file:bg-brand/5"
              />
              <p className="text-xs text-muted-foreground">PDF only, up to 5 MB.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-brand text-white hover:bg-brand/90"
              disabled={busy || (mode === 'template' ? !previewIsFresh : !file)}
            >
              {sending ? 'Sending…' : 'Send offer letter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
