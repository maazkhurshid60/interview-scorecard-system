import templates from '../templates/emails.js';

const PLACEHOLDER = /\{\s*(\w+)\s*\}/g; // {name} and { name } both work

const placeholdersIn = (text) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
const isMissing = (value) => value === undefined || value === null || String(value).trim() === '';

// Checked once, when the server starts: a typo in the wording must never reach a candidate.
Object.entries(templates).forEach(([key, template]) => {
  placeholdersIn(`${template.subject}\n${template.body}`).forEach((name) => {
    if (!template.details.includes(name)) {
      throw new Error(`Email template "${key}" uses {${name}}, which is not one of its details (${template.details.join(', ')}). Fix templates/emails.js.`);
    }
  });
});

/**
 * Builds the subject and the plain-text body of one email.
 * A body line that needs a detail we do not have is left out; blank lines never pile up.
 * @param {keyof typeof templates} key Which email (a key of templates/emails.js).
 * @param {Record<string, string|number|null|undefined>} values The details, by name.
 * @returns {{subject: string, text: string}}
 */
function renderEmail(key, values = {}) {
  const template = templates[key];
  if (!template) throw new Error(`Unknown email template "${key}".`);
  const fill = (line) => line.replace(PLACEHOLDER, (_, name) => String(values[name] ?? '').trim());

  const subject = fill(template.subject).replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
  const lines = template.body
    .split('\n')
    .filter((line) => !placeholdersIn(line).some((name) => isMissing(values[name])))
    .map(fill);

  const text = lines
    .filter((line, index) => !(line.trim() === '' && (index === 0 || lines[index - 1].trim() === '')))
    .join('\n')
    .trim();
  return { subject, text };
}

export { renderEmail };
