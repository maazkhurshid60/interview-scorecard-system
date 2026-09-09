import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plug, SlidersHorizontal, FileText, DollarSign, Info, CheckCircle2, XCircle,
} from 'lucide-react';
import api from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '../utils/formatters';

const RETENTION_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 120, label: '120 days' },
];

const SERVICES = [
  {
    key: 'claude', label: 'Claude API',
    blurb: 'Generates scorecards and scores every interview.',
    fields: [{ settingKey: 'anthropicApiKey', label: 'API Key' }],
  },
  {
    key: 'google_meet', label: 'Google Meet',
    blurb: 'Creates meeting links and fetches transcripts.',
    fields: [
      { settingKey: 'googleClientId', label: 'Client ID' },
      { settingKey: 'googleClientSecret', label: 'Client Secret' },
      { settingKey: 'googleRefreshToken', label: 'Refresh Token' },
    ],
  },
  {
    key: 'slack', label: 'Slack',
    blurb: 'Posts notifications when a stage is scored or decided.',
    fields: [{ settingKey: 'slackWebhookUrl', label: 'Webhook URL' }],
  },
];

const KNOWN_MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

const MODEL_TIERS = [
  { key: 'claudeModelCheap', label: 'Cheap tier', hint: 'Résumé Screen, Reference Check, Background Check' },
  { key: 'claudeModelDefault', label: 'Default tier', hint: 'HR Screen, Final/CEO, Client, Culture Fit' },
  { key: 'claudeModelDeep', label: 'Deep tier', hint: 'Technical, Simulation, Task Performance' },
];

export default function Settings() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [settings, setSettings] = useState({});
  const [keyStatus, setKeyStatus] = useState({});
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [settingsRes, keyStatusRes, usageRes] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/key-status'),
        api.get('/settings/ai-usage'),
      ]);
      setSettings(Object.fromEntries(settingsRes.data.settings.map((s) => [s.key, s.value])));
      setKeyStatus(keyStatusRes.data);
      setUsage(usageRes.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function saveSetting(key, value) {
    setSavingKey(key);
    try {
      await api.put(`/settings/${key}`, { value });
      setSettings((prev) => ({ ...prev, [key]: value }));
      toast.success('Saved.');
    } finally {
      setSavingKey(null);
    }
  }

  // Deliberately separate from saveSetting: never caches the raw value in
  // React state (not even briefly) — reloads from the server, which returns
  // credential keys stripped, so the real value never lingers client-side.
  async function saveSecret(key, value) {
    setSavingKey(key);
    try {
      await api.put(`/settings/${key}`, { value });
      toast.success('Saved.');
      await load();
    } finally {
      setSavingKey(null);
    }
  }

  async function testConnection(service) {
    setTesting((prev) => ({ ...prev, [service]: true }));
    try {
      const res = await api.post('/settings/test-api', { service });
      setTestResults((prev) => ({ ...prev, [service]: res.data }));
      if (res.data.status === 'ok') toast.success(`${service}: connected.`);
      else toast.error(res.data.message || `${service}: connection failed.`);
    } finally {
      setTesting((prev) => ({ ...prev, [service]: false }));
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-7 w-32" />
        </div>
        <Skeleton className="mt-5 h-9 w-96" />
        <div className="mt-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const spendCap = Number(settings.monthlyAiSpendCapUsd) || 0;
  const totalSpend = usage?.totalCostUsd || 0;

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Credentials, scoring thresholds, retention and AI spend.
          </p>
        </div>
      </div>

      {!isAdmin && (
        <Alert variant="warning" className="mt-4">
          <Info />
          <AlertDescription>
            You’re viewing Settings as a non-admin — everything here is read-only.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="integrations" className="mt-5">
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="integrations"><Plug />Integrations</TabsTrigger>
          <TabsTrigger value="scoring"><SlidersHorizontal />Scoring</TabsTrigger>
          <TabsTrigger value="transcripts"><FileText />Transcripts</TabsTrigger>
          <TabsTrigger value="spend"><DollarSign />Spend & Usage</TabsTrigger>
        </TabsList>

        {/* ================= INTEGRATIONS ================= */}
        <TabsContent value="integrations" className="space-y-4">
          {SERVICES.map((svc) => {
            const status = keyStatus[svc.key] || {};
            const result = testResults[svc.key];
            return (
              <Card key={svc.key}>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{svc.label}</span>
                        <Badge
                          variant="secondary"
                          className={`font-normal ${status.configured ? 'bg-green-100 text-green-800 hover:bg-green-100' : ''}`}
                        >
                          {status.configured ? 'Configured' : 'Not configured'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{svc.blurb}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {result && (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${result.status === 'ok' ? 'text-green-700' : 'text-red-700'}`}
                        >
                          {result.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {result.status === 'ok' ? 'Connected' : (result.message || 'Failed')}
                        </span>
                      )}
                      <Button
                        size="sm"
                        onClick={() => testConnection(svc.key)}
                        disabled={!isAdmin || testing[svc.key]}
                        className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
                      >
                        {testing[svc.key] ? 'Testing…' : 'Test connection'}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-border pt-4">
                    {svc.fields.map((f) => (
                      <MaskedKeyInput
                        key={f.settingKey}
                        label={f.label}
                        masked={status.keys?.[f.settingKey]}
                        disabled={!isAdmin}
                        saving={savingKey === f.settingKey}
                        onSave={(v) => saveSecret(f.settingKey, v)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Alert>
            <Info />
            <AlertDescription className="text-muted-foreground">
              Keys are masked — only the last 4 characters are ever shown. The real value stays on the
              server and falls back to <code className="font-mono text-xs">.env</code> until you set one here.
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* ================= SCORING ================= */}
        <TabsContent value="scoring" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Scoring thresholds</CardTitle>
              <CardDescription>
                A candidate needs every gate passed <em>and</em> a weighted total at or above the hire
                threshold. Below the maybe threshold is a no-hire.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberSetting
                  label="Hire threshold" value={settings.hireThreshold} disabled={!isAdmin}
                  saving={savingKey === 'hireThreshold'}
                  onSave={(v) => saveSetting('hireThreshold', v)} step={0.1} min={1} max={5}
                />
                <NumberSetting
                  label="Maybe threshold" value={settings.maybeThreshold} disabled={!isAdmin}
                  saving={savingKey === 'maybeThreshold'}
                  onSave={(v) => saveSetting('maybeThreshold', v)} step={0.1} min={1} max={5}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Claude models</CardTitle>
              <CardDescription>
                Change which model each tier uses without touching <code className="font-mono text-xs">.env</code> or
                redeploying — e.g. move the deep tier to Opus for a hard technical round, then back to save cost.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                {MODEL_TIERS.map((tier) => (
                  <ModelSetting
                    key={tier.key}
                    label={tier.label} hint={tier.hint}
                    value={settings[tier.key]} disabled={!isAdmin} saving={savingKey === tier.key}
                    onSave={(v) => saveSetting(tier.key, v)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TRANSCRIPTS ================= */}
        <TabsContent value="transcripts">
          <Card>
            <CardHeader>
              <CardTitle>Transcripts & provider</CardTitle>
              <CardDescription>
                After a requisition closes and the retention window passes, transcripts and AI
                justifications are purged — numeric scores and the audit log are always kept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="retention">Transcript retention</Label>
                  <Select
                    value={String(settings.transcriptRetentionDays ?? 90)}
                    onValueChange={(v) => saveSetting('transcriptRetentionDays', Number(v))}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger id="retention"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RETENTION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider">Active transcript provider</Label>
                  <Select
                    value={settings.activeTranscriptProvider ?? 'google_meet'}
                    onValueChange={(v) => saveSetting('activeTranscriptProvider', v)}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="google_meet">Google Meet</SelectItem>
                      <SelectItem value="zoom">Zoom (not implemented yet)</SelectItem>
                      <SelectItem value="fathom">Fathom (not implemented yet)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= SPEND & USAGE ================= */}
        <TabsContent value="spend" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI spend controls</CardTitle>
              <CardDescription>
                Scoring is blocked once the monthly cap is reached — raise it here to unblock.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberSetting
                  label="Monthly AI spend cap (USD)" value={settings.monthlyAiSpendCapUsd}
                  disabled={!isAdmin} saving={savingKey === 'monthlyAiSpendCapUsd'}
                  onSave={(v) => saveSetting('monthlyAiSpendCapUsd', v)} step={10} min={0}
                />
                <NumberSetting
                  label="Warn at % of cap" value={settings.aiSpendWarnPercent}
                  disabled={!isAdmin} saving={savingKey === 'aiSpendWarnPercent'}
                  onSave={(v) => saveSetting('aiSpendWarnPercent', v)} step={5} min={0} max={100}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>AI usage</CardTitle>
                <CardDescription>Cost per requisition and stage, all time.</CardDescription>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-foreground">{formatCurrency(totalSpend)}</div>
                {spendCap > 0 && <div className="text-xs text-muted-foreground">of a {formatCurrency(spendCap)} cap</div>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!usage || usage.rows.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No AI usage recorded yet.</p>
              ) : (
                <>
                  {/* md and up — table */}
                  <div className="hidden max-h-[32rem] overflow-y-auto border-t border-border md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky top-0 bg-background">Month</TableHead>
                          <TableHead className="sticky top-0 bg-background">Requisition</TableHead>
                          <TableHead className="sticky top-0 bg-background">Stage</TableHead>
                          <TableHead className="sticky top-0 bg-background">Model</TableHead>
                          <TableHead className="sticky top-0 bg-background text-right">Interviews</TableHead>
                          <TableHead className="sticky top-0 bg-background text-right">Tokens in/out</TableHead>
                          <TableHead className="sticky top-0 bg-background text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.rows.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">{r.month}</TableCell>
                            <TableCell className="py-2.5 text-sm">{r.requisitionTitle}</TableCell>
                            <TableCell className="py-2.5 text-xs text-muted-foreground">{r.stageKey}</TableCell>
                            <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">{r.model || '—'}</TableCell>
                            <TableCell className="py-2.5 text-right text-sm">{r.interviewCount}</TableCell>
                            <TableCell className="whitespace-nowrap py-2.5 text-right text-xs text-muted-foreground">
                              {r.totalInputTokens.toLocaleString()} / {r.totalOutputTokens.toLocaleString()}
                            </TableCell>
                            <TableCell className="py-2.5 text-right text-sm font-medium">{formatCurrency(r.totalCostUsd)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* below md — stacked */}
                  <div className="space-y-3 p-4 md:hidden">
                    {usage.rows.map((r, i) => (
                      <div key={i} className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{r.requisitionTitle}</span>
                          <span className="flex-shrink-0 text-sm font-medium">{formatCurrency(r.totalCostUsd)}</span>
                        </div>
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          <div>{r.month} · {r.stageKey}</div>
                          <div className="font-mono">{r.model || '—'}</div>
                          <div>
                            {r.interviewCount} interview{r.interviewCount === 1 ? '' : 's'} ·{' '}
                            {r.totalInputTokens.toLocaleString()} in / {r.totalOutputTokens.toLocaleString()} out
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NumberSetting({ label, value, onSave, disabled, saving, step, min, max }) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const numDraft = Number(draft);
  const changed = numDraft !== Number(value);
  const isInvalid = (min !== undefined && numDraft < min) || (max !== undefined && numDraft > max);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-start gap-2">
        <div className="flex w-full flex-col gap-1">
          <Input
            type="number" value={draft} step={step} min={min} max={max} disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            className={`disabled:bg-muted ${isInvalid ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
          />
          {isInvalid && (
            <span className="text-[10px] leading-tight text-red-500">
              Must be {min}-{max}
            </span>
          )}
        </div>
        {!disabled && changed && (
          <Button
            onClick={() => onSave(numDraft)} disabled={saving || isInvalid}
            className="flex-shrink-0 bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
          >
            {saving ? '…' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Model picker for one Claude tier: preset dropdown (no typo risk) with an "Other" escape hatch for a model not on the list yet. */
function ModelSetting({ label, hint, value, onSave, disabled, saving }) {
  const isKnown = KNOWN_MODELS.some((m) => m.id === value);
  const [customMode, setCustomMode] = useState(!!value && !isKnown);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    setDraft(value || '');
    setCustomMode(!!value && !KNOWN_MODELS.some((m) => m.id === value));
  }, [value]);

  const changed = draft !== (value || '');

  function handleSelectChange(v) {
    if (v === '__other__') {
      setCustomMode(true);
      setDraft('');
    } else {
      setDraft(v);
    }
  }

  return (
    <div className="space-y-1.5">
      <div>
        <Label>{label}</Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex gap-2">
        {customMode ? (
          <>
            <Input
              type="text" value={draft} disabled={disabled} placeholder="e.g. claude-opus-5"
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-xs disabled:bg-muted"
            />
            {!disabled && (
              <Button
                variant="ghost" size="sm" className="flex-shrink-0"
                onClick={() => { setCustomMode(false); setDraft(isKnown ? value : ''); }}
              >
                Use list
              </Button>
            )}
          </>
        ) : (
          <Select value={draft || undefined} onValueChange={handleSelectChange} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="Select a model…" /></SelectTrigger>
            <SelectContent>
              {KNOWN_MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              <SelectItem value="__other__">Other (type manually)…</SelectItem>
            </SelectContent>
          </Select>
        )}
        {!disabled && changed && draft && (
          <Button
            onClick={() => onSave(draft)} disabled={saving}
            className="flex-shrink-0 bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
          >
            {saving ? '…' : 'Save'}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Current: <span className="font-mono">{value || '—'}</span>
      </p>
    </div>
  );
}

/**
 * One credential field: shows only the masked preview the server sent
 * (e.g. "••••••1234") — the real value never reaches this component except
 * for whatever the admin is actively typing to replace it with.
 */
function MaskedKeyInput({ label, masked, onSave, disabled, saving }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  async function handleSave() {
    await onSave(draft);
    setEditing(false);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-32 flex-shrink-0 text-xs text-muted-foreground">{label}</span>
      {editing ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            type="text" value={draft} autoFocus placeholder="Paste new value…"
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
          />
          <Button
            size="sm" onClick={handleSave} disabled={saving || !draft}
            className="flex-shrink-0 bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
          >
            {saving ? '…' : 'Save'}
          </Button>
          <Button
            variant="ghost" size="sm" className="flex-shrink-0"
            onClick={() => { setEditing(false); setDraft(''); }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">{masked || 'Not configured'}</span>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {masked ? 'Replace' : 'Set'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
