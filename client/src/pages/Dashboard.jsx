import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Users, DollarSign, Activity, Loader2 } from 'lucide-react';
import dayjs from 'dayjs';
import api from '../hooks/useApi';
import StatsCard from '../components/StatsCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '../utils/formatters';

/**
 * Overview dashboard: open requisitions, candidates still in flight (active
 * applications with no final decision yet), AI spend this calendar month,
 * and the most recent audit activity.
 */
export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [openRequisitions, setOpenRequisitions] = useState([]);
  const [candidatesInFlight, setCandidatesInFlight] = useState(0);
  const [spendThisMonth, setSpendThisMonth] = useState(0);
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [requisitionsRes, usageRes, auditRes] = await Promise.all([
          api.get('/requisitions', { params: { status: 'open' } }),
          api.get('/settings/ai-usage'),
          api.get('/audit', { params: { limit: 5 } }),
        ]);
        if (cancelled) return;

        const requisitions = requisitionsRes.data.requisitions;
        setOpenRequisitions(requisitions);

        // Candidates "in flight" = active applications (no final decision yet)
        // across every open requisition.
        const detailResults = await Promise.all(
          requisitions.map((r) => api.get(`/requisitions/${r._id}`))
        );
        if (cancelled) return;
        const inFlightCount = detailResults.reduce((sum, res) => {
          const active = res.data.applications.filter((a) => !a.finalDecision);
          return sum + active.length;
        }, 0);
        setCandidatesInFlight(inFlightCount);

        const currentMonthKey = dayjs().format('YYYY-MM');
        const monthSpend = usageRes.data.rows
          .filter((row) => row.month === currentMonthKey)
          .reduce((sum, row) => sum + row.totalCostUsd, 0);
        setSpendThisMonth(monthSpend);

        setRecentActivity(auditRes.data.entries);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-[#d21e2b]" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Overview of hiring activity across all open requisitions.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Open Requisitions" value={openRequisitions.length} icon={Briefcase} />
        <StatsCard label="Candidates in Flight" value={candidatesInFlight} icon={Users} hint="Active applications, no final decision yet" />
        <StatsCard label="AI Spend This Month" value={`$${spendThisMonth.toFixed(2)}`} icon={DollarSign} />
        <StatsCard label="Recent Activity" value={recentActivity.length} icon={Activity} hint="Audit entries shown below" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open Requisitions</CardTitle>
          </CardHeader>
          <CardContent>
            {openRequisitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open requisitions yet.</p>
            ) : (
              <ul className="-mx-6 divide-y divide-border">
                {openRequisitions.slice(0, 5).map((r) => (
                  <li key={r._id}>
                    <Link
                      to={`/requisitions/${r._id}`}
                      className="block px-6 py-3 text-sm text-foreground transition-colors hover:bg-[#d21e2b]/5"
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <ul className="-mx-6 divide-y divide-border">
                {recentActivity.map((entry) => (
                  <li key={entry._id} className="flex flex-col items-start gap-1 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-0">
                    <Badge variant="secondary" className="capitalize">
                      {entry.action.replace(/_/g, ' ')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</span>
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
