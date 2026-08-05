import { Link } from 'react-router-dom';
import { Check, X, Clock } from 'lucide-react';

const STATUS_STYLES = {
  passed: { circle: 'bg-green-600 text-white', icon: Check },
  approved: { circle: 'bg-green-600 text-white', icon: Check },
  failed: { circle: 'bg-red-500 text-white', icon: X },
  scored: { circle: 'bg-amber-400 text-white', icon: Clock },
  transcript_pending: { circle: 'bg-amber-300 text-white', icon: Clock },
  scheduled: { circle: 'bg-blue-300 text-white', icon: Clock },
  pending: { circle: 'bg-gray-200 text-gray-500', icon: null },
};

/**
 * Stage-by-stage progress stepper. Without `progress`, shows the pipeline's
 * structure only (neutral). With `progress` (an Application's stageProgress,
 * keyed by stageKey -> status), colors each step by that candidate's actual
 * status — pass/fail/in-progress/pending.
 *
 * With `stageLinks` (stageKey -> interviewId), any stage that already has an
 * interview becomes a link back to that stage's InterviewRoom — otherwise
 * there's no way to revisit an earlier (even already-approved) stage once
 * you've navigated away from it.
 *
 * @param {{stages: Array<{key:string, label:string, enabled:boolean}>, progress?: Record<string,string>, stageLinks?: Record<string,string>, compact?: boolean}} props
 */
export default function PipelineStepper({ stages, progress, stageLinks, compact }) {
  const enabledStages = stages.filter((s) => s.enabled);

  return (
    <div className="relative">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {enabledStages.map((stage, index) => {
          const status = progress?.[stage.key] || 'pending';
          const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
          const Icon = style.icon;
          const interviewId = stageLinks?.[stage.key];

          const circle = (
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${style.circle} ${interviewId ? 'cursor-pointer ring-offset-1 hover:ring-2 hover:ring-gray-400' : ''}`}>
              {Icon ? <Icon className="h-3.5 w-3.5" /> : index + 1}
            </div>
          );

          return (
            <div key={stage.key} className="flex items-center">
              <div className="flex flex-col items-center" title={`${stage.label}: ${status.replace('_', ' ')}${interviewId ? ' — click to open' : ''}`}>
                {interviewId ? <Link to={`/interview/${interviewId}`}>{circle}</Link> : circle}
                {!compact && <span className="mt-1 max-w-[4.5rem] truncate text-center text-[10px] text-gray-500">{stage.label}</span>}
              </div>
              {index < enabledStages.length - 1 && <div className="mx-1 h-px w-4 flex-shrink-0 bg-gray-300" />}
            </div>
          );
        })}
      </div>
      {enabledStages.length > 4 && (
        <div className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-white to-transparent" />
      )}
    </div>
  );
}
