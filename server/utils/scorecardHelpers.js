const crypto = require('crypto');

/**
 * Uses each application question and its ideal answer / JD context as the
 * HR-screen rubric. Returns true when the scorecard's HR stages were changed.
 * Shared by the requisition controller and the background application processor.
 */
function syncHrQuestionnaireRubric(scorecard, requisition) {
  let updated = false;
  ['hr_screen', 'hr_interview'].forEach((stageKey) => {
    const hrStage = scorecard?.stages?.find((stage) => stage.stageKey === stageKey);
    if (!hrStage) return;

    const attributes = (requisition.questionnaire || []).map((item, index) => {
      const question = typeof item === 'string' ? item : item.question;
      const idealAnswer = typeof item === 'object' ? item.idealAnswer : '';
      const requireIdealAnswer = typeof item === 'object' ? Boolean(item.requireIdealAnswer) : false;

      let anchor5 = 'Fully addresses the question with a clear, relevant answer aligned with the Job Description requirements.';
      let redFlags = 'Does not answer the question, or provides an unclear or irrelevant response.';

      if (idealAnswer) {
        anchor5 = `Ideal answer benchmark: ${idealAnswer}`;
        redFlags = `Does not address or match the required ideal answer benchmark: "${idealAnswer}".`;
      }

      return {
        attributeId: `${hrStage.stageKey || 'hr_screen'}_question_${index + 1}`,
        name: `Question ${index + 1}`,
        question,
        anchor5,
        redFlags,
        requireIdealAnswer,
        idealAnswer,
      };
    });

    if (JSON.stringify(hrStage.attributes) !== JSON.stringify(attributes)) {
      hrStage.attributes = attributes;
      updated = true;
    }
  });
  return updated;
}

/** Gives every scorecard attribute that lacks an id a stable, unique one. */
function assignMissingAttributeIds(stages) {
  stages.forEach((stage) => {
    stage.attributes.forEach((attr, index) => {
      if (!attr.attributeId) {
        attr.attributeId = `${stage.stageKey}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
      }
    });
  });
}

module.exports = { syncHrQuestionnaireRubric, assignMissingAttributeIds };
