import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import api from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
    fields: [{ settingKey: 'anthropicApiKey', label: 'API Key' }],
  },
  {
    key: 'google_meet', label: 'Google Meet',
    fields: [
      { settingKey: 'googleClientId', label: 'Client ID' },
      { settingKey: 'googleClientSecret', label: 'Client Secret' },
      { settingKey: 'googleRefreshToken', label: 'Refresh Token' },
    ],
  },
  {
    key: 'slack', label: 'Slack',
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

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          disabled={!canGoBack}
          className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      </div>
      {!isAdmin && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You're viewing Settings as a non-admin — values are read-only.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>External Services</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {SERVICES.map((svc) => {
              const status = keyStatus[svc.key] || {};
              const result = testResults[svc.key];
              return (
                <Card key={svc.key} className="shadow-none">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${status.configured ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className="text-sm font-medium text-foreground">{svc.label}</span>
                        <span className="text-xs text-muted-foreground">{status.configured ? 'Configured' : 'Not configured'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {result && (
                          <span className={`text-xs font-medium ${result.status === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
                            {result.status === 'ok' ? 'OK' : (result.message || 'Failed')}
                          </span>
                        )}
                        <button
                          type="button" onClick={() => testConnection(svc.key)} disabled={!isAdmin || testing[svc.key]}
                          className="rounded-md bg-[#d21e2b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {testing[svc.key] ? 'Testing...' : 'Test Connection'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
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
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Keys are masked — only the last 4 characters are ever shown. The real value stays on the server and falls back to .env until you set one here.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claude Models</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {MODEL_TIERS.map((tier) => (
              <ModelSetting
                key={tier.key}
                label={tier.label} hint={tier.hint}
                value={settings[tier.key]} disabled={!isAdmin} saving={savingKey === tier.key}
                onSave={(v) => saveSetting(tier.key, v)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Change which model each tier uses without touching .env or redeploying — e.g. switch the deep tier from Sonnet to Opus for a hard technical round, then switch it back to save cost.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scoring Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberSetting
              label="Hire threshold" value={settings.hireThreshold} disabled={!isAdmin} saving={savingKey === 'hireThreshold'}
              onSave={(v) => saveSetting('hireThreshold', v)} step={0.1} min={1} max={5}
            />
            <NumberSetting
              label="Maybe threshold" value={settings.maybeThreshold} disabled={!isAdmin} saving={savingKey === 'maybeThreshold'}
              onSave={(v) => saveSetting('maybeThreshold', v)} step={0.1} min={1} max={5}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcripts & Provider</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-foreground">Transcript retention</label>
              <Select
                value={String(settings.transcriptRetentionDays ?? 90)}
                onValueChange={(v) => saveSetting('transcriptRetentionDays', Number(v))}
                disabled={!isAdmin}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">Active transcript provider</label>
              <Select
                value={settings.activeTranscriptProvider ?? 'google_meet'}
                onValueChange={(v) => saveSetting('activeTranscriptProvider', v)}
                disabled={!isAdmin}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
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

      <Card>
        <CardHeader>
          <CardTitle>AI Spend Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberSetting
              label="Monthly AI spend cap (USD)" value={settings.monthlyAiSpendCapUsd} disabled={!isAdmin} saving={savingKey === 'monthlyAiSpendCapUsd'}
              onSave={(v) => saveSetting('monthlyAiSpendCapUsd', v)} step={10} min={0}
            />
            <NumberSetting
              label="Warn at % of cap" value={settings.aiSpendWarnPercent} disabled={!isAdmin} saving={savingKey === 'aiSpendWarnPercent'}
              onSave={(v) => saveSetting('aiSpendWarnPercent', v)} step={5} min={0} max={100}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>AI Usage</CardTitle>
          <span className="text-sm font-semibold text-foreground">Total: {formatCurrency(usage?.totalCostUsd)}</span>
        </CardHeader>
        <CardContent>
          {!usage || usage.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI usage recorded yet.</p>
          ) : (
            <>
              {/* md: and up — real table */}
              <div className="hidden max-h-[32rem] overflow-y-auto overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="sticky top-0 bg-white px-3 py-2">Month</th>
                      <th className="sticky top-0 bg-white px-3 py-2">Requisition</th>
                      <th className="sticky top-0 bg-white px-3 py-2">Stage</th>
                      <th className="sticky top-0 bg-white px-3 py-2">Model</th>
                      <th className="sticky top-0 bg-white px-3 py-2">Interviews</th>
                      <th className="sticky top-0 bg-white px-3 py-2">Tokens (in/out)</th>
                      <th className="sticky top-0 bg-white px-3 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {usage.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{r.month}</td>
                        <td className="px-3 py-2">{r.requisitionTitle}</td>
                        <td className="px-3 py-2">{r.stageKey}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.model || '—'}</td>
                        <td className="px-3 py-2">{r.interviewCount}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.totalInputTokens} / {r.totalOutputTokens}</td>
                        <td className="px-3 py-2 font-medium">{formatCurrency(r.totalCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* below md — stacked card per row */}
              <div className="space-y-3 md:hidden">
                {usage.rows.map((r, i) => (
                  <div key={i} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{r.requisitionTitle}</span>
                      <span className="text-sm font-medium text-foreground">{formatCurrency(r.totalCostUsd)}</span>
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <div>{r.month} · {r.stageKey}</div>
                      <div>{r.model || '—'} · {r.interviewCount} interview{r.interviewCount === 1 ? '' : 's'}</div>
                      <div>Tokens: {r.totalInputTokens} in / {r.totalOutputTokens} out</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberSetting({ label, value, onSave, disabled, saving, step, min, max }) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const changed = Number(draft) !== Number(value);

  return (
    <div>
      <label className="block text-sm font-medium text-foreground">{label}</label>
      <div className="mt-1 flex gap-2">
        <input
          type="number" value={draft} step={step} min={min} max={max} disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b] disabled:bg-muted"
        />
        {!disabled && changed && (
          <button
            type="button" onClick={() => onSave(Number(draft))} disabled={saving}
            className="flex-shrink-0 rounded-md bg-[#d21e2b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:opacity-50"
          >
            {saving ? '...' : 'Save'}
          </button>
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
    <div>
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1 flex gap-2">
        {customMode ? (
          <>
            <input
              type="text" value={draft} disabled={disabled} placeholder="e.g. claude-opus-5"
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b] disabled:bg-muted"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => { setCustomMode(false); setDraft(isKnown ? value : ''); }}
                className="flex-shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
              >
                Use list
              </button>
            )}
          </>
        ) : (
          <Select value={draft || undefined} onValueChange={handleSelectChange} disabled={disabled}>
            <SelectTrigger>
              <SelectValue placeholder="Select a model..." />
            </SelectTrigger>
            <SelectContent>
              {KNOWN_MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              <SelectItem value="__other__">Other (type manually)...</SelectItem>
            </SelectContent>
          </Select>
        )}
        {!disabled && changed && draft && (
          <button
            type="button" onClick={() => onSave(draft)} disabled={saving}
            className="flex-shrink-0 rounded-md bg-[#d21e2b] px-3 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:opacity-50"
          >
            {saving ? '...' : 'Save'}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Current: <span className="font-mono">{value || '—'}</span></p>
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
          <input
            type="text" value={draft} autoFocus placeholder="Paste new value..."
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono focus:border-[#d21e2b] focus:outline-none focus:ring-1 focus:ring-[#d21e2b]"
          />
          <button
            type="button" onClick={handleSave} disabled={saving || !draft}
            className="flex-shrink-0 rounded-md bg-[#d21e2b] px-2 py-1 text-xs font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '...' : 'Save'}
          </button>
          <button
            type="button" onClick={() => { setEditing(false); setDraft(''); }}
            className="flex-shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">{masked || 'Not configured'}</span>
          {!disabled && (
            <button
              type="button" onClick={() => setEditing(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {masked ? 'Replace' : 'Set'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
