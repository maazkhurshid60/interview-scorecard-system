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
  disabled: { circle: 'bg-gray-200 text-gray-400 opacity-60', icon: null },
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
 * With `currentStageKey` + `onStartStage`, the one stage that's next up (no
 * interview yet, but unlocked) becomes clickable too — clicking it starts
 * that stage instead of just sitting there inert. Stages further ahead stay
 * inert, so nobody can skip ahead out of order.
 *
 * @param {{
 *   stages: Array<{key:string, label:string, enabled:boolean}>,
 *   progress?: Record<string,string>,
 *   stageLinks?: Record<string,string>,
 *   linkState?: object,      // router state sent with each stage link (see lib/interviewNavigation.js)
 *   linkReplace?: boolean,   // replace the current history entry instead of adding one
 *   currentStageKey?: string,
 *   onStartStage?: (stageKey: string) => void,
 *   startingStageKey?: string|null,
 *   disabled?: boolean,
 *   compact?: boolean,
 *   hideScrollbar?: boolean,
 * }} props
 */
export default function PipelineStepper({ stages, progress, stageLinks, linkState, linkReplace = false, currentStageKey, onStartStage, startingStageKey, disabled = false, compact, hideScrollbar = false }) {
  const enabledStages = stages.filter((s) => s.enabled);
  let priorStageFailed = false;

  return (
    <div className="relative">
      <div className={`flex items-center gap-1 overflow-x-auto pb-1 ${hideScrollbar ? '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden' : ''}`}>
        {enabledStages.map((stage, index) => {
          const rawProgress = progress?.[stage.key];
          let rawStatus = typeof rawProgress === 'string' ? rawProgress : rawProgress?.status || 'pending';
          const passed = typeof rawProgress === 'object' ? rawProgress?.passed : null;

          if (passed === false || rawStatus === 'failed') {
            rawStatus = 'failed';
          } else if (passed === true || rawStatus === 'passed' || (rawStatus === 'approved' && passed !== false)) {
            rawStatus = 'passed';
          }

          const isBlocked = priorStageFailed || disabled;

          if (rawStatus === 'failed') {
            priorStageFailed = true;
          }

          const interviewId = isBlocked ? null : stageLinks?.[stage.key];
          let status = isBlocked ? 'disabled' : rawStatus;
          if (status === 'pending' && interviewId) {
            status = 'scheduled';
          }


          const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
          const Icon = style.icon;
          const canStart = !isBlocked && !interviewId && onStartStage && stage.key === currentStageKey;
          const isStarting = startingStageKey === stage.key;

          const circle = (
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${style.circle} ${interviewId || canStart ? 'cursor-pointer ring-offset-1 hover:ring-2 hover:ring-gray-400' : ''} ${isStarting ? 'opacity-50' : ''}`}>
              {Icon ? <Icon className="h-3.5 w-3.5" /> : index + 1}
            </div>
          );

          let content = circle;
          if (interviewId) {
            content = <Link to={`/interview/${interviewId}`} state={linkState} replace={linkReplace}>{circle}</Link>;
          } else if (canStart) {
            content = (
              <button type="button" onClick={() => onStartStage(stage.key)} disabled={isStarting}>
                {circle}
              </button>
            );
          }

          const title = disabled
            ? `${stage.label}: disabled (requisition is not open)`
            : isBlocked
              ? `${stage.label}: disabled (prior stage failed)`
            : interviewId
              ? `${stage.label}: ${status.replace('_', ' ')} — click to open`
              : canStart
                ? `${stage.label} — click to start`
                : `${stage.label}: ${status.replace('_', ' ')}`;

          return (
            <div key={stage.key} className="flex items-center">
              <div className="flex flex-col items-center" title={title}>
                {content}
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
