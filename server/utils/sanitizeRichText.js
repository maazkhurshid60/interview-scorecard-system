const sanitizeHtml = require('sanitize-html');

/**
 * Cleans the rich text of a job description before it is stored.
 *
 * The editor (Quill) only produces headings, bold / italic / underline / strike, ordered and bullet
 * lists, and links, so that is all that is allowed through. Everything else is removed: scripts,
 * styles, iframes, forms, images, event handlers such as onerror / onclick, and links that run code
 * (javascript:, data:). Links are forced to open safely in a new tab.
 *
 * Text that has no HTML tags at all is plain text. It is returned unchanged, because the app shows plain
 * text as text (never as HTML), and cleaning it would turn "A & B" into "A &amp; B".
 */

const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i; // the same test RichTextViewer uses on the screen

const OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ol', 'ul', 'li', 'a', 'blockquote', 'pre', 'code', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    li: ['data-list'], // Quill 2 marks bullet / numbered items with data-list
    '*': ['class'],
  },
  // Only the editor's own style classes (ql-align-center, ql-indent-1, ql-ui ...) may stay.
  allowedClasses: { '*': [/^ql-[a-z0-9-]+$/] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard', // drop a disallowed tag but keep its text
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
    }),
  },
  // Script, style and similar tags are removed together with their content.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
};

/**
 * @param {*} value - A job description. Non-strings are returned as they are.
 * @returns {*} The cleaned rich text, or the same plain text.
 */
function cleanRichText(value) {
  if (typeof value !== 'string') return value;
  if (!LOOKS_LIKE_HTML.test(value)) return value;
  return sanitizeHtml(value, OPTIONS);
}

module.exports = { cleanRichText };
