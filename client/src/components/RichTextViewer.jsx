import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';

/**
 * Only the formatting the editor produces is allowed through: headings, bold / italic / underline / strike,
 * lists, links. Scripts, styles, iframes, forms, images, event handlers (onerror, onclick ...) and links that
 * run code (javascript:) are removed before anything reaches the page. The server cleans the text when a job
 * is saved as well; cleaning again here also covers older or hand-edited records.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'ol', 'ul', 'li', 'a', 'blockquote', 'pre', 'code', 'span',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'data-list'];
const EDITOR_CLASS = /^ql-[a-z0-9-]+$/; // the editor's own style classes (ql-align-center, ql-indent-1, ql-ui ...)

let hooksReady = false;
function prepareCleaner() {
  if (hooksReady) return;
  hooksReady = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Links always open in a new tab and cannot reach back to this page.
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // Only the editor's own classes may stay.
    if (node.hasAttribute && node.hasAttribute('class')) {
      const kept = node.getAttribute('class').split(/\s+/).filter((name) => EDITOR_CLASS.test(name));
      if (kept.length) node.setAttribute('class', kept.join(' '));
      else node.removeAttribute('class');
    }
  });
}

/** @param {string} html @returns {string} The same text with everything unsafe removed. */
export function cleanHtml(html) {
  prepareCleaner();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
}

/**
 * RichTextViewer component cleanly renders formatted HTML content or plain text descriptions.
 */
export default function RichTextViewer({ content, className = '' }) {
  // Check if content looks like HTML
  const isHtml = Boolean(content) && /<[a-z][\s\S]*>/i.test(content);
  const safeHtml = useMemo(() => (isHtml ? cleanHtml(content) : ''), [isHtml, content]);

  if (!content) {
    return <span className="text-muted-foreground italic">Not specified</span>;
  }

  if (isHtml) {
    return (
      <div
        className={`rich-text-content ${className}`}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {content}
    </div>
  );
}
