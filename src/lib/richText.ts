/**
 * AniList (and admin-entered) descriptions arrive with real newlines, <br> tags,
 * HTML entities, literal "\n" escape sequences and AniList markdown
 * (__bold__, ~!spoiler!~, [text](url)). normalizeRichText turns all of that into
 * clean text with real line breaks; the markdown markers are rendered by <RichText/>.
 */
const decodeEntities = (value: string) => value
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#039;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeChar(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => safeChar(Number(code)))
  .replace(/&amp;/g, '&');
const safeChar = (code: number) => { try { return String.fromCodePoint(code); } catch { return ''; } };

export function normalizeRichText(value = ''): string {
  return decodeEntities(String(value)
    .replace(/\r\n?/g, '\n')
    // Escaped newlines stored as text, e.g. "line one\\nline two" or "line one /n line two".
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/(^|[\s.,!?;:)])\/n(?=\s|$|[A-Z"“(])/g, '$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?(?:b|strong)>/gi, '__')
    .replace(/<\/?(?:i|em)>/gi, '_')
    .replace(/<[^>]*>/g, ''))
    .split('\n').map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain-text version (no markdown markers) — safe for titles, previews and meta text. */
export function cleanDescription(value = ''): string {
  return normalizeRichText(value)
    .replace(/~!([\s\S]*?)!~/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2');
}
