const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { ValidationError } = require('../utils/errors');
const { getCalendarTimeZone } = require('../utils/calendarTimeZone');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * The offer letter templates: Word files kept on the server, with the tags
 * ({{candidate_name}}, {{starting_salary}} ...) that are replaced when a letter
 * is made. Staff pick a template by KEY; the key is looked up here, so the
 * browser can never choose a file path.
 *
 * Adding a template = one Word file in the templates folder + one entry below.
 */

const TEMPLATES_DIR = process.env.OFFER_TEMPLATES_DIR
  ? path.resolve(process.env.OFFER_TEMPLATES_DIR)
  : path.join(__dirname, '..', 'templates', 'offer-letters');

const POSITION = { key: 'position', label: 'Position', type: 'text', required: true, hint: 'Shown as "selected for ___ position".' };
const SHIFT_START = { key: 'shift_start', label: 'Shift starts', type: 'time', required: true };
const SHIFT_END = { key: 'shift_end', label: 'Shift ends', type: 'time', required: true };
const STARTING_SALARY = { key: 'starting_salary', label: 'Starting salary (PKR per month)', type: 'salary', required: true };
const SALARY_AFTER = { key: 'salary_after_probation', label: 'Salary after probation (PKR per month)', type: 'salary', required: true };

const TEMPLATES = [
  {
    key: 'fixed-salary',
    label: 'Fixed salary',
    description: 'Salary stays the same after probation.',
    file: 'Offer Letter – Fixed Salary.docx',
    fields: [POSITION, STARTING_SALARY, SHIFT_START, SHIFT_END],
    sameSalaryAfterProbation: true,
  },
  {
    key: 'fixed-salary-commission',
    label: 'Fixed salary with commission',
    description: 'Salary plus commission; salary stays the same after probation.',
    file: 'Offer Letter – Fixed Salary with Commission.docx',
    fields: [POSITION, STARTING_SALARY, SHIFT_START, SHIFT_END],
    sameSalaryAfterProbation: true,
  },
  {
    key: 'revised-salary',
    label: 'Revised salary',
    description: 'Salary is revised after probation.',
    file: 'Offer Letter – Revised Salary.docx',
    fields: [POSITION, STARTING_SALARY, SALARY_AFTER, SHIFT_START, SHIFT_END],
  },
  {
    key: 'revised-salary-commission',
    label: 'Revised salary with commission',
    description: 'Salary plus commission; salary is revised after probation.',
    file: 'Offer Letter – Revised Salary with Commission.docx',
    fields: [POSITION, STARTING_SALARY, SALARY_AFTER, SHIFT_START, SHIFT_END],
  },
  {
    key: 'unpaid-internship',
    label: 'Unpaid internship',
    description: 'Three-month unpaid internship.',
    file: 'Unpaid Internship Offer Letter.docx',
    fields: [POSITION, SHIFT_START, SHIFT_END],
  },
];

const byKey = new Map(TEMPLATES.map((t) => [t.key, t]));

function getTemplate(key) {
  return byKey.get(String(key || '')) || null;
}

function templatePath(template) {
  return path.join(TEMPLATES_DIR, template.file);
}

/** What the screen needs: each template, its fields, and whether its Word file is on this server. */
function listTemplates() {
  return TEMPLATES.map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    available: fs.existsSync(templatePath(t)),
    fields: t.fields.map(({ key, label, type, required, hint }) => ({ key, label, type, required, hint: hint || null })),
  }));
}

// ---------------------------------------------------------------- cleaning the typed values

const POSITION_RE = /^[A-Za-z0-9][A-Za-z0-9 &/().,+'-]*$/;

function cleanText(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanSalary(value) {
  const digits = String(value ?? '').replace(/[,\s]/g, '').replace(/\/-$/, '');
  if (!/^\d{1,9}$/.test(digits) || Number(digits) <= 0) return null;
  return Number(digits).toLocaleString('en-US');
}

/** Accepts "19:00" or "7:00 PM" (any case, optional space) and returns "7:00 PM". */
function cleanTime(value) {
  const m = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (minute > 59) return null;
  if (m[3]) {
    if (hour < 1 || hour > 12) return null;
    const pm = m[3].toLowerCase() === 'pm';
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** Today's date as it appears at the top of the letter, for example "October 19, 2026". */
function letterDate(now = new Date()) {
  return dayjs(now).tz(getCalendarTimeZone() || 'Asia/Karachi').format('MMMM D, YYYY');
}

/**
 * Checks the typed values for a template and returns both what is put into the
 * letter (`values`, every tag) and what is saved on the application (`fields`).
 * Throws ValidationError listing every field that is wrong.
 *
 * @param {object} template - From getTemplate().
 * @param {object} input - The values typed by staff.
 * @param {{ candidateName: string, now?: Date }} context
 */
function prepareValues(template, input, { candidateName, now } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const fields = {};

  for (const field of template.fields) {
    const raw = source[field.key];
    let cleaned = null;
    if (field.type === 'salary') cleaned = cleanSalary(raw);
    else if (field.type === 'time') cleaned = cleanTime(raw);
    else {
      const text = cleanText(raw);
      cleaned = text.length >= 2 && text.length <= 80 && POSITION_RE.test(text) ? text : null;
    }
    if (cleaned === null) {
      errors[field.key] = field.type === 'salary'
        ? `${field.label}: enter a whole number, for example 85000.`
        : field.type === 'time'
          ? `${field.label}: enter a time, for example 7:00 PM.`
          : `${field.label}: enter 2 to 80 letters or numbers.`;
    } else {
      fields[field.key] = cleaned;
    }
  }

  const name = cleanText(candidateName).slice(0, 100);
  if (!name) errors.candidate_name = 'The candidate has no name on file.';

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(Object.keys(errors), Object.values(errors).join(' '));
  }

  const values = {
    date: letterDate(now),
    candidate_name: name,
    position: fields.position,
    starting_salary: fields.starting_salary,
    salary_after_probation: template.sameSalaryAfterProbation ? fields.starting_salary : fields.salary_after_probation,
    shift_start: fields.shift_start,
    shift_end: fields.shift_end,
  };
  return { values, fields };
}

module.exports = { TEMPLATES_DIR, getTemplate, templatePath, listTemplates, prepareValues, letterDate, cleanSalary, cleanTime };
