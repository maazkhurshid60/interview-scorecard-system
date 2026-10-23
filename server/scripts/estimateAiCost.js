/**
 * Estimates the AI (Claude) cost of one job opening and of a month of hiring, before any real traffic.
 *
 * It builds the same prompts the app sends (the fixed instructions are read straight from
 * services/aiScorer.js and services/questionGenerator.js, so they stay in step with the code),
 * fills the variable parts with text of the sizes you give, and counts tokens as characters / 4.
 * Nothing is sent to Anthropic and nothing is read from the database.
 *
 * Usage:
 *   node scripts/estimateAiCost.js                         (typical job, 100 applications)
 *   node scripts/estimateAiCost.js --profile=large --apps=300 --jobs=10
 *   node scripts/estimateAiCost.js --jd-words=650 --resume-words=1100 --questions=6
 *
 * Sizes (words unless stated): --jd-words --resume-words --criteria (rows) --questions --answer-words
 *   --stages (scored stages in the pipeline) --questions-per-stage (AI-written interview questions)
 * Volume: --apps (applications per job) --jobs (jobs per month) --interview-share (0-1) --interview-stages
 *   --transcript-tokens
 *
 * Prices: USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-21).
 * Prices change: re-check the page before sharing a report.
 */
const fs = require('fs');
const path = require('path');

const PRICES = {
  'Haiku 5.5': [0.10, 0.50],
  'Haiku 4.5': [1, 5],
  'Sonnet 5 / 5.5': [2, 10],
  'Opus 5.5': [4, 20],
  'Opus 5': [5, 25],
};

const PROFILES = {
  small: { jdWords: 300, resumeWords: 400, criteria: 3, questions: 3, answerWords: 40, stages: 4, questionsPerStage: 5 },
  typical: { jdWords: 500, resumeWords: 800, criteria: 5, questions: 5, answerWords: 60, stages: 6, questionsPerStage: 6 },
  large: { jdWords: 900, resumeWords: 1600, criteria: 6, questions: 8, answerWords: 100, stages: 8, questionsPerStage: 7 },
};

// ---------------------------------------------------------------- arguments
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const profileName = args.profile || 'typical';
if (!PROFILES[profileName]) { console.error(`Unknown profile "${profileName}". Use: ${Object.keys(PROFILES).join(', ')}`); process.exit(1); }
const num = (key, fallback) => (args[key] !== undefined ? Number(args[key]) : fallback);
const base = PROFILES[profileName];
const size = {
  jdWords: num('jd-words', base.jdWords),
  resumeWords: num('resume-words', base.resumeWords),
  criteria: num('criteria', base.criteria),
  questions: num('questions', base.questions),
  answerWords: num('answer-words', base.answerWords),
  stages: num('stages', base.stages),
  questionsPerStage: num('questions-per-stage', base.questionsPerStage),
};
const volume = {
  apps: num('apps', 100),
  jobs: num('jobs', 10),
  interviewShare: num('interview-share', 0.1),
  interviewStages: num('interview-stages', 2),
  transcriptTokens: num('transcript-tokens', 8000),
};

// ---------------------------------------------------------------- text and tokens
const tokens = (text) => Math.ceil(text.length / 4);
const FILLER = ['the', 'team', 'hiring', 'skills', 'work', 'role', 'talent']; // 5.7 characters per word with the space, like ordinary English
/** Text of n words. */
const words = (n) => Array.from({ length: n }, (_, i) => FILLER[i % FILLER.length]).join(' ');

const root = path.join(__dirname, '..', 'services');
const aiScorer = fs.readFileSync(path.join(root, 'aiScorer.js'), 'utf8');
const questionGenerator = fs.readFileSync(path.join(root, 'questionGenerator.js'), 'utf8');
const grab = (source, regex, label) => {
  const m = source.match(regex);
  if (!m) { console.error(`Could not find ${label} in the code; the script needs updating.`); process.exit(1); }
  return m[1];
};
const SCORING_SYSTEM = grab(aiScorer, /const SYSTEM_PROMPT = `([\s\S]*?)`;/, 'the scoring instructions');
const HR_GUIDELINES = grab(aiScorer, /EVALUATION GUIDELINES FOR QUESTIONNAIRE RESPONSES:([\s\S]*?)---/, 'the questionnaire guidelines');
const SCORECARD_SYSTEM = grab(questionGenerator, /\nconst SYSTEM_PROMPT = `([\s\S]*?)`;/, 'the scorecard instructions');
const OUTPUT_TOKENS_PER_GENERATED_QUESTION = Number(grab(questionGenerator, /~(\d+) tokens per attribute/, 'the 250-token budget'));
const STAGES_PER_CALL = Number(grab(questionGenerator, /const STAGES_PER_CALL = (\d+);/, 'STAGES_PER_CALL'));

const TITLE = 'Senior Sales Executive';
const jd = words(size.jdWords);
const criteriaText = Array.from({ length: size.criteria }, (_, i) => `- Criteria: Item ${i + 1} | Requirement: ${words(10)}`).join('\n');
const questionnaire = Array.from({ length: size.questions }, (_, i) => ({ question: words(15), ideal: words(40), answer: words(size.answerWords), i }));

// ---------------------------------------------------------------- one application (2 calls)
const rubricAttribute = (id, name, question, anchor, red) => `attributeId: "${id}"\nname: ${name}\nquestion: ${question}\nwhat a 5 looks like: ${anchor}\nred flags (1-2): ${red}`;

const resumePrompt = `POSITION TITLE: ${TITLE}\n\nJOB DESCRIPTION:\n${jd}\n\nINITIAL SCREENING CRITERIA:\n${criteriaText}\n\n---\nCANDIDATE RESUME TEXT:\n${words(size.resumeWords)}\n\n---\nRUBRIC (score every attribute below):\n\n${
  rubricAttribute('a1', 'Overall Resume & Qualification Evaluation', words(30), words(40), words(30))}`;
const hrPrompt = `POSITION TITLE: ${TITLE}\n\nJOB DESCRIPTION:\n${jd}\n\nEVALUATION GUIDELINES FOR QUESTIONNAIRE RESPONSES:${HR_GUIDELINES}---\nAPPLICATION QUESTIONNAIRE RESPONSES:\n${
  questionnaire.map((q) => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n')}\n\n---\nRUBRIC (score every attribute below):\n\n${
  questionnaire.map((q) => rubricAttribute(`a${q.i + 1}`, `Question ${q.i + 1}`, q.question, q.ideal, 'Does not answer the question, or provides an unclear or irrelevant response.')).join('\n\n')}`;

// A reply is one JSON object per question: ids, score and a short reason (about 25 tokens of structure plus the reason).
const reply = (justificationWords, count) => count * (25 + Math.ceil(justificationWords * 1.4));
const resumeCall = { in: tokens(SCORING_SYSTEM) + tokens(resumePrompt), out: reply(70, 1) };
const hrCall = { in: tokens(SCORING_SYSTEM) + tokens(hrPrompt), out: reply(32, size.questions) };
const application = { in: resumeCall.in + hrCall.in, out: resumeCall.out + hrCall.out };

// ---------------------------------------------------------------- one job opening (scorecard, once)
const batches = Math.ceil(size.stages / STAGES_PER_CALL);
const stagesPerBatch = Math.ceil(size.stages / batches);
const scorecardInput = tokens(SCORECARD_SYSTEM)
  + tokens(`Job Title: ${TITLE}\n\nJob Description:\n${jd}\n\nInitial Screening Criteria:\n${criteriaText}\n\nApplication Questionnaire Items:\n${questionnaire.map((q) => `- Question: ${q.question} | Ideal Answer: ${q.ideal}`).join('\n')}\n\nStages to generate attributes for:\n`)
  + stagesPerBatch * 25;
// The AI writes 1 question for the resume stage, none for the HR screen, and questionsPerStage for every other stage.
const generatedQuestions = 1 + Math.max(0, size.stages - 2) * size.questionsPerStage;
const setup = { in: scorecardInput * batches, out: generatedQuestions * OUTPUT_TOKENS_PER_GENERATED_QUESTION };

// ---------------------------------------------------------------- interview scoring (later stages)
const interviewStage = { in: tokens(SCORING_SYSTEM) + volume.transcriptTokens + size.questionsPerStage * 150, out: reply(32, size.questionsPerStage) };

// ---------------------------------------------------------------- report
const usd = (t, [pin, pout]) => (t.in * pin + t.out * pout) / 1e6;
const money = (n) => (n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const n = (v) => Math.round(v).toLocaleString('en-US');
const total = (t) => t.in + t.out;
const row = (cells) => `| ${cells.join(' | ')} |`;

const jobTokens = { in: setup.in + application.in * volume.apps, out: setup.out + application.out * volume.apps };
const interviews = Math.round(volume.apps * volume.interviewShare) * volume.interviewStages;
const jobWithInterviews = { in: jobTokens.in + interviews * interviewStage.in, out: jobTokens.out + interviews * interviewStage.out };
const month = { in: jobWithInterviews.in * volume.jobs, out: jobWithInterviews.out * volume.jobs };

console.log(`# AI cost estimate (profile: ${profileName})\n`);
console.log(`Sizes: job description ${size.jdWords} words, resume ${size.resumeWords} words, ${size.criteria} criteria rows, ${size.questions} questionnaire questions of ${size.answerWords} words, ${size.stages} scored stages.`);
console.log(`Volume: ${volume.apps} applications per job, ${volume.jobs} jobs per month, ${Math.round(volume.interviewShare * 100)}% of applicants reach ${volume.interviewStages} interview stages (${n(volume.transcriptTokens)}-token transcripts).\n`);

console.log('## Tokens');
console.log(row(['Step', 'Input', 'Output', 'Total']), '\n| --- | --- | --- | --- |');
[['Resume scoring call', resumeCall], ['Questionnaire scoring call', hrCall], ['**One application**', application],
  [`Job setup, once (${batches} scorecard calls)`, setup], ['One interview stage (estimate)', interviewStage],
  [`One job with ${volume.apps} applications, no interviews`, jobTokens], [`One job incl. ${interviews} interview-stage scorings`, jobWithInterviews],
  [`Whole month (${volume.jobs} jobs)`, month]].forEach(([label, t]) => console.log(row([label, n(t.in), n(t.out), n(total(t))])));

console.log('\n## Cost in USD (price per million tokens, input / output)');
console.log(row(['Model', 'Per application', 'Job setup', `One job (${volume.apps} apps)`, `Month (${volume.jobs} jobs, with interviews)`]), '\n| --- | --- | --- | --- | --- |');
Object.entries(PRICES).forEach(([name, p]) => console.log(row([`${name} ($${p[0]} / $${p[1]})`, money(usd(application, p)), money(usd(setup, p)), money(usd(jobTokens, p)), money(usd(month, p))])));
console.log('\nToken counts are characters / 4 and the reply sizes are assumptions: treat the result as an estimate, and replace the sizes with your real averages.');
