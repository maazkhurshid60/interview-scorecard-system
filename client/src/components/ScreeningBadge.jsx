import { Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isScreeningActive, isScreeningFailed } from '../lib/screening';

/**
 * Shows where the background AI scoring of an application stands:
 * "Scoring…" while it runs, "Needs manual scoring" if it could not finish.
 * Renders nothing for any other application, so callers can show their own
 * fallback.
 */
export default function ScreeningBadge({ application, className = '' }) {
  if (isScreeningActive(application)) {
    return (
      <Badge
        variant="secondary"
        title="The AI is scoring this application. The page updates by itself."
        className={`gap-1 bg-blue-100 font-normal text-blue-800 hover:bg-blue-100 ${className}`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Scoring…
      </Badge>
    );
  }
  if (isScreeningFailed(application)) {
    const reason = application.screeningJob?.lastError;
    return (
      <Badge
        variant="secondary"
        title={reason ? `Automatic scoring stopped: ${reason}` : 'Automatic scoring could not finish. Open the application to score it by hand.'}
        className={`gap-1 bg-amber-100 font-normal text-amber-800 hover:bg-amber-100 ${className}`}
      >
        <AlertTriangle className="h-3 w-3" />
        Needs manual scoring
      </Badge>
    );
  }
  return null;
}
