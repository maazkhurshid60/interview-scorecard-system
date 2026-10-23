const fs = require('fs/promises');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const logger = require('../utils/logger');
const { ValidationError, OfferLetterError } = require('../utils/errors');
const { getTemplate, templatePath, prepareValues } = require('./offerLetterTemplates');
const { convert, ConverterUnavailableError } = require('./officeConverter');

/**
 * Makes an offer letter PDF from a template:
 *   check the typed values -> fill the Word template -> convert it to PDF.
 * Nothing is stored here; the caller decides what to do with the PDF.
 */

function safeFileName(candidateName) {
  const base = String(candidateName || 'Candidate').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Candidate';
  return `Offer Letter - ${base}.pdf`;
}

/**
 * @param {object} params
 * @param {string} params.templateKey
 * @param {object} params.fields - Values typed by staff (see offerLetterTemplates.js).
 * @param {string} params.candidateName
 * @param {Date} [params.now]
 * @returns {Promise<{ pdf: Buffer, fileName: string, fields: object, templateKey: string }>}
 */
async function generateOfferLetter({ templateKey, fields, candidateName, now }) {
  const template = getTemplate(templateKey);
  if (!template) throw new ValidationError(['templateKey'], 'Choose one of the offer letter templates.');

  const { values, fields: cleaned } = prepareValues(template, fields, { candidateName, now });

  let docx;
  try {
    docx = await fs.readFile(templatePath(template));
  } catch (err) {
    logger.error(`[OfferLetter] Template file for "${template.key}" is missing on this server: ${err.message}`);
    throw new OfferLetterError('This template is not set up on the server yet. Ask an administrator, or upload a PDF instead.', 503);
  }

  let filled;
  try {
    const doc = new Docxtemplater(new PizZip(docx), {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      // A tag with no value must stop the letter, never print "undefined" in it.
      nullGetter(part) { throw new Error(`no value for the tag "${part.value}"`); },
    });
    doc.render(values);
    filled = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (err) {
    const detail = err.properties?.errors?.map((e) => e.message).join('; ') || err.message;
    logger.error(`[OfferLetter] Could not fill "${template.key}": ${detail}`);
    throw new OfferLetterError('The template could not be filled in. Ask an administrator, or upload a PDF instead.');
  }

  let pdf;
  try {
    pdf = await convert(filled);
  } catch (err) {
    logger.error(`[OfferLetter] PDF conversion failed for "${template.key}": ${err.message}`);
    if (err instanceof ConverterUnavailableError) {
      throw new OfferLetterError('Letters cannot be created on this server right now. Upload a PDF instead.', 503);
    }
    throw new OfferLetterError('The letter could not be turned into a PDF. Try again, or upload a PDF instead.');
  }

  return { pdf, fileName: safeFileName(values.candidate_name), fields: cleaned, templateKey: template.key };
}

module.exports = { generateOfferLetter };
