/**
 * Editable weight inputs for a pipeline's enabled, scored stages (transcript/
 * artifact input types — pass_fail/status_only stages have no weight).
 * Purely controlled: the parent owns the actual stages array (since
 * toggling/reordering/weighting all submit together in one PATCH) — this
 * component just renders inputs and reports percentage changes upward.
 * Weights are entered as percentages for readability; the real
 * auto-normalization to sum-to-100% happens server-side on save.
 *
 * @param {{
 *   stages: Array<{key:string, label:string, enabled:boolean, inputType:string, weight:number}>,
 *   onChangeWeight: (key: string, percent: number) => void,
 * }} props
 */
export default function WeightConfig({ stages, onChangeWeight }) {
  const scoredStages = stages.filter((s) => s.enabled && (s.inputType === 'transcript' || s.inputType === 'artifact'));

  if (scoredStages.length === 0) {
    return <p className="text-sm text-gray-500">No enabled scored stages to weight.</p>;
  }

  // Sum the true fractions first, then round once — rounding each stage's
  // percentage independently before summing can show 99%/101% even when the
  // underlying weights are already fine (e.g. 18.52 + 64.82 + 16.67 rounds
  // per-stage to 19 + 65 + 17 = 101, but the true total is ~100.01).
  const liveSum = Math.round(scoredStages.reduce((sum, s) => sum + s.weight, 0) * 100);

  return (
    <div className="space-y-2">
      {scoredStages.map((s) => (
        <div key={s.key} className="flex items-center gap-3">
          <span className="w-40 flex-shrink-0 text-sm text-gray-700">{s.label}</span>
          <input
            type="number"
            min="0"
            max="100"
            value={Math.round(s.weight * 100)}
            onChange={(e) => onChangeWeight(s.key, Number(e.target.value) || 0)}
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
      ))}
      <div className={`text-xs ${liveSum === 100 ? 'text-gray-400' : 'text-amber-600'}`}>
        Current sum: {liveSum}% {liveSum !== 100 && '— will be auto-normalized to 100% on save'}
      </div>
    </div>
  );
}
