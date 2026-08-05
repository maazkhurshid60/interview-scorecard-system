import { Card, CardContent } from '@/components/ui/card';

/**
 * A single metric tile for the Dashboard (e.g. "Open Requisitions: 4").
 * @param {{label: string, value: string|number, icon?: React.ComponentType, hint?: string}} props
 */
export default function StatsCard({ label, value, icon: Icon, hint }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {Icon && <Icon className="h-5 w-5 text-[#d21e2b]" />}
        </div>
        <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground/70">{hint}</div>}
      </CardContent>
    </Card>
  );
}
