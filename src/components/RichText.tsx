import { useState, type ReactNode } from 'react';
import { normalizeRichText } from '../lib/richText';
import './rich-text.css';

// Order matters: spoilers can contain other markup, links before emphasis.
const TOKEN_SOURCE = /~!([\s\S]*?)!~|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|__([^\n]+?)__|\*\*([^\n]+?)\*\*|(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/;

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return <span
    className={shown ? 'rich-spoiler shown' : 'rich-spoiler'}
    role="button" tabIndex={0} aria-label={shown ? undefined : 'Spoiler, tap to reveal'}
    onClick={() => setShown(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShown(true); } }}
  >{children}</span>;
}

function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0; let index = 0;
  // A fresh RegExp per call: nested markup (bold inside a spoiler) recurses, and a
  // shared global regex would share lastIndex across levels.
  const token = new RegExp(TOKEN_SOURCE.source, 'g');
  for (let match = token.exec(text); match; match = token.exec(text)) {
    const [whole, spoiler, linkText, linkUrl, bold, bold2, italicLead, italic] = match;
    const start = match.index + (italicLead?.length || 0);
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}${index++}`;
    if (spoiler !== undefined) out.push(<Spoiler key={key}>{renderInline(spoiler.trim(), key + '-')}</Spoiler>);
    else if (linkText !== undefined) out.push(<a key={key} className="rich-link" href={linkUrl} target="_blank" rel="noopener noreferrer">{linkText}</a>);
    else if (bold !== undefined || bold2 !== undefined) out.push(<strong key={key}>{renderInline(bold ?? bold2, key + '-')}</strong>);
    else if (italic !== undefined) out.push(<em key={key}>{italic}</em>);
    last = match.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders AniList / catalogue descriptions with real paragraphs and formatting.
 * Output is React elements only (never innerHTML), so it is XSS-safe.
 */
export function RichText({ text, fallback }: { text?: string | null; fallback: string }) {
  const value = normalizeRichText(text || '');
  if (!value) return <>{fallback}</>;
  return <>{renderInline(value)}</>;
}
