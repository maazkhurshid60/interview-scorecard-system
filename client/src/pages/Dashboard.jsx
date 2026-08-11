import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, Users, DollarSign, Activity, Plus, ChevronRight, UserPlus,
} from 'lucide-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../hooks/useApi';
import StatsCard from '../components/StatsCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

dayjs.extend(relativeTime);

const STATUS_BADGE = {
  open: 'bg-green-100 text-green-800 hover:bg-green-100',
  on_hold: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  closed: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
};

/** Reads a scalar Setting out of the /settings payload, tolerating a missing row. */
function settingValue(settings, key, fallback) {
  const row = (settings || []).find((s) => s.key === key);
  return row?.value ?? fallback;
}

/**
 * Overview dashboard: open requisitions, candidates still in flight (active
 * applications with no final decision yet), AI spend this calendar month
 * against the configured cap, and the most recent audit activity.
 */
export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [openRequisitions, setOpenRequisitions] = useState([]);
  const [candidatesInFlight, setCandidatesInFlight] = useState(0);
  const [spendThisMonth, setSpendThisMonth] = useState(0);
  const [spendCap, setSpendCap] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [requisitionsRes, usageRes, auditRes, settingsRes] = await Promise.all([
          api.get('/requisitions', { params: { status: 'open' } }),
          api.get('/settings/ai-usage'),
          api.get('/audit', { params: { limit: 6 } }),
          api.get('/settings'),
        ]);
        if (cancelled) return;

        const requisitions = requisitionsRes.data.requisitions;
        setOpenRequisitions(requisitions);

        // candidateStats already rides along with the list response, so the
        // in-flight count is a reduce rather than one detail request per
        // requisition (which was N+1 and grew with every open role).
        setCandidatesInFlight(
          requisitions.reduce((sum, r) => sum + (r.candidateStats?.inProgress || 0), 0)
        );

        const currentMonthKey = dayjs().format('YYYY-MM');
        setSpendThisMonth(
          usageRes.data.rows
            .filter((row) => row.month === currentMonthKey)
            .reduce((sum, row) => sum + row.totalCostUsd, 0)
        );

        setRecentActivity(auditRes.data.entries);
        setAuditTotal(auditRes.data.total ?? auditRes.data.entries.length);

        const cap = Number(settingValue(settingsRes.data.settings, 'monthlyAiSpendCapUsd', NaN));
        setSpendCap(Number.isFinite(cap) ? cap : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const totalCandidates = openRequisitions.reduce((sum, r) => sum + (r.candidateStats?.total || 0), 0);
  const capHint = spendCap ? `of a $${spendCap} monthly cap` : undefined;

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview of hiring activity across all open requisitions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/candidates">
              <UserPlus />
              Add candidate
            </Link>
          </Button>
          <Button asChild className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90">
            <Link to="/requisitions">
              <Plus />
              New requisition
            </Link>
          </Button>
        </div>
      </div>

      {/* ---------- stat tiles ---------- */}
      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            label="Open Requisitions" value={openRequisitions.length} icon={Briefcase}
            hint={totalCandidates > 0 ? `${totalCandidates} candidates attached` : 'No candidates attached yet'}
          />
          <StatsCard
            label="Candidates in Flight" value={candidatesInFlight} icon={Users}
            hint="Active applications, no final decision yet"
          />
          <StatsCard
            label="AI Spend This Month" value={`$${spendThisMonth.toFixed(2)}`} icon={DollarSign}
            hint={capHint}
          />
          <StatsCard
            label="Audit Entries" value={auditTotal} icon={Activity}
            hint="Every score, override and decision on record"
          />
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ---------- open requisitions ---------- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Open Requisitions</CardTitle>
            {!loading && openRequisitions.length > 5 && (
              <Link to="/requisitions" className="text-xs font-medium text-[#d21e2b] hover:underline">
                View all {openRequisitions.length}
              </Link>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-4 px-6 pb-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                ))}
              </div>
            ) : openRequisitions.length === 0 ? (
              <div className="px-6 pb-8 pt-2 text-center">
                <p className="text-sm text-muted-foreground">No open requisitions yet.</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/requisitions">Create the first one</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {openRequisitions.slice(0, 5).map((r) => {
                  const stats = r.candidateStats || { total: 0, inProgress: 0 };
                  return (
                    <li key={r._id}>
                      <Link
                        to={`/requisitions/${r._id}`}
                        className="flex items-center justify-between gap-3 px-6 py-3 transition-colors hover:bg-[#d21e2b]/5"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{r.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {stats.total === 0
                              ? 'No candidates yet'
                              : `${stats.total} candidate${stats.total === 1 ? '' : 's'}${stats.inProgress ? ` · ${stats.inProgress} in progress` : ''}`}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <Badge variant="secondary" className={`font-normal ${STATUS_BADGE[r.status] || ''}`}>
                            Open
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ---------- recent activity ---------- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent Activity</CardTitle>
            {!loading && recentActivity.length > 0 && (
              <Link to="/audit-log" className="text-xs font-medium text-[#d21e2b] hover:underline">
                View audit log
              </Link>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-4 px-6 pb-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-5 w-32 rounded-full" />
                    <Skeleton className="h-3 w-52" />
                  </div>
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <p className="px-6 pb-8 pt-2 text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {recentActivity.map((entry) => (
                  <li key={entry._id} className="px-6 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <Badge variant="secondary" className="font-normal capitalize">
                        {entry.action.replace(/_/g, ' ')}
                      </Badge>
                      <span
                        className="flex-shrink-0 text-xs text-muted-foreground"
                        title={dayjs(entry.timestamp).format('D MMM YYYY, HH:mm')}
                      >
                        {dayjs(entry.timestamp).fromNow()}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {entry.userId?.name ? <span className="text-foreground">{entry.userId.name}</span> : 'System'}
                      {entry.reason ? ` — ${entry.reason}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
