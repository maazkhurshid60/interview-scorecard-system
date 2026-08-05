import { useState } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Edits a scorecard's per-stage attributes (name, question, "what a 5 looks
 * like", "red flags"). Add/remove attributes freely; nothing is persisted
 * until "Save Scorecard" is clicked.
 *
 * @param {{
 *   scorecard: {stages: Array<{stageKey:string, attributes:Array}>},
 *   stageLabels: Record<string,string>,
 *   onSave: (stages: Array) => Promise<void>,
 *   saving?: boolean,
 * }} props
 */
export default function ScorecardEditor({ scorecard, stageLabels, onSave, saving }) {
  const [stages, setStages] = useState(() => JSON.parse(JSON.stringify(scorecard.stages || [])));
  const [openStages, setOpenStages] = useState(() => new Set(stages.length > 0 ? [stages[0].stageKey] : []));

  function toggleStage(stageKey) {
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageKey)) next.delete(stageKey);
      else next.add(stageKey);
      return next;
    });
  }

  function updateAttribute(stageIndex, attrIndex, field, value) {
    setStages((prev) => {
      const next = [...prev];
      next[stageIndex] = { ...next[stageIndex], attributes: [...next[stageIndex].attributes] };
      next[stageIndex].attributes[attrIndex] = { ...next[stageIndex].attributes[attrIndex], [field]: value };
      return next;
    });
  }

  function addAttribute(stageIndex) {
    setStages((prev) => {
      const next = [...prev];
      next[stageIndex] = {
        ...next[stageIndex],
        attributes: [...next[stageIndex].attributes, { name: '', question: '', anchor5: '', redFlags: '' }],
      };
      return next;
    });
  }

  function removeAttribute(stageIndex, attrIndex) {
    setStages((prev) => {
      const next = [...prev];
      next[stageIndex] = { ...next[stageIndex], attributes: next[stageIndex].attributes.filter((_, i) => i !== attrIndex) };
      return next;
    });
  }

  async function handleSave() {
    const hasEmptyName = stages.some((s) => s.attributes.some((a) => !a.name?.trim()));
    if (hasEmptyName) {
      toast.error('Every attribute needs a name before saving.');
      return;
    }
    await onSave(stages);
  }

  return (
    <div className="space-y-6">
      {stages.map((stage, stageIndex) => {
        const isOpen = openStages.has(stage.stageKey);
        return (
          <div key={stage.stageKey} className="rounded-lg border border-gray-200 bg-white p-4">
            <button
              type="button"
              onClick={() => toggleStage(stage.stageKey)}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-sm font-semibold text-gray-900">
                {stageLabels?.[stage.stageKey] || stage.stageKey}
                <span className="ml-2 text-xs font-normal text-gray-400">({stage.attributes.length} attributes)</span>
              </h3>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <>
                <div className="mt-3 space-y-4">
                  {stage.attributes.map((attr, attrIndex) => (
                    <div key={attrIndex} className="rounded-md border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <input
                          type="text"
                          value={attr.name}
                          onChange={(e) => updateAttribute(stageIndex, attrIndex, 'name', e.target.value)}
                          placeholder="Attribute name"
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm font-medium focus:border-gray-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttribute(stageIndex, attrIndex)}
                          className="flex-shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="Remove attribute"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div>
                          <label className="text-xs font-medium text-gray-500">Question</label>
                          <textarea
                            value={attr.question || ''}
                            onChange={(e) => updateAttribute(stageIndex, attrIndex, 'question', e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gray-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500">What a 5 looks like</label>
                          <textarea
                            value={attr.anchor5 || ''}
                            onChange={(e) => updateAttribute(stageIndex, attrIndex, 'anchor5', e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gray-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500">Red flags (1-2)</label>
                          <textarea
                            value={attr.redFlags || ''}
                            onChange={(e) => updateAttribute(stageIndex, attrIndex, 'redFlags', e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gray-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => addAttribute(stageIndex)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add attribute
                </button>
              </>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-[#d21e2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#d21e2b]/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Scorecard'}
      </button>
    </div>
  );
}
