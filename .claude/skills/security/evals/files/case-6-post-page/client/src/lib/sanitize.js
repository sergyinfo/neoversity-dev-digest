import DOMPurify from 'dompurify';

export const RICH_TEXT_OPTIONS = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'ul', 'ol', 'li',
    'a', 'h2', 'h3', 'blockquote', 'code', 'pre',
  ],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeRichText(html) {
  return DOMPurify.sanitize(String(html ?? ''), RICH_TEXT_OPTIONS);
}
