import { AlertTriangle, Info, XCircle } from 'lucide-react';

const VARIANTS = {
  info: { icon: Info, classes: 'bg-blue-50 text-blue-800 border-blue-200' },
  warning: { icon: AlertTriangle, classes: 'bg-amber-50 text-amber-800 border-amber-200' },
  error: { icon: XCircle, classes: 'bg-red-50 text-red-800 border-red-200' },
};

/**
 * Inline banner for warnings/errors/info messages (e.g. spend-cap warnings,
 * transcript-not-ready notices).
 * @param {{type?: 'info'|'warning'|'error', message: string}} props
 */
export default function AlertBanner({ type = 'info', message }) {
  const { icon: Icon, classes } = VARIANTS[type] || VARIANTS.info;
  return (
    <div className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${classes}`}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}
