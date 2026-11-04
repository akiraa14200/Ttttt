import { useBackLayer } from '../lib/backNav';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, BookmarkCheck, ChevronLeft, Download, Flag, Play, Share2, X, ExternalLink } from 'lucide-react';
import type { RelatedVideo } from '../lib/catalogue';
import { supabase } from '../lib/supabase';
import { shareLink, showToast } from './Extras';
import './video-actions.css';

/* ---------------- Download ---------------- */
const DIRECT_FILE = /\.(mp4|webm|m4v|mov|ogv|mkv)(\?|#|$)/i;
export const isDirectVideoFile = (url: string) => { try { return DIRECT_FILE.test(new URL(url).pathname); } catch { return false; } };
export const providerName = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '').toLowerCase();
    if (host === 'youtu.be' || host.includes('youtube')) return 'YouTube';
    if (host === 'dai.ly' || host.includes('dailymotion')) return 'Dailymotion';
    if (host.includes('instagram') || host === 'instagr.am') return 'Instagram';
    if (host.includes('tiktok')) return 'TikTok';
    return host;
  } catch { return 'the provider'; }
};
const isNative = () => !!(window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

async function downloadVideo(video: RelatedVideo) {
  const url = video.videoUrl;
  if (isDirectVideoFile(url)) {
    const name = `${(video.videoTitle || video.titleName || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'video'}${(new URL(url).pathname.match(DIRECT_FILE)?.[0] || '.mp4').replace(/[?#].*$/, '')}`;
    if (!isNative()) {
      try {
        // Same-origin or CORS-enabled files download with a proper file name.
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(String(response.status));
        const blobUrl = URL.createObjectURL(await response.blob());
        const a = Object.assign(document.createElement('a'), { href: blobUrl, download: name });
        document.body.appendChild(a); a.click(); a.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
        showToast('Download started');
        return;
      } catch { /* fall through to a plain link */ }
      const a = Object.assign(document.createElement('a'), { href: url, download: name, target: '_blank', rel: 'noopener noreferrer' });
      document.body.appendChild(a); a.click(); a.remove();
      showToast('Download started');
      return;
    }
    // In the Android app the system browser's download manager handles the file.
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast('Opening download in your browser');
    return;
  }
  // Streaming providers only allow offline saving inside their own apps.
  window.open(url, '_blank', 'noopener,noreferrer');
  showToast(`Opening ${providerName(url)}. Use its Download button to save offline.`);
}

/* ---------------- Report ---------------- */
export const REPORT_REASONS = ['Video is broken or unavailable', 'Wrong title or information', 'Inappropriate content', 'Spam or misleading', 'Copyright concern', 'Something else'] as const;
type PendingReport = { video_id: string; video_url: string; video_title: string | null; reason: string; details: string | null };
const PENDING_KEY = 'rykoc-pending-video-reports';
const REPORTED_KEY = 'rykoc-reported-videos';
const readJson = <T,>(key: string, fallback: T): T => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };
export const hasReported = (id: string) => readJson<string[]>(REPORTED_KEY, []).includes(id);

async function sendReport(report: PendingReport) {
  const { error } = await supabase.from('video_reports').insert(report);
  if (error) throw error;
}
/** Retries reports that were stored on this device while the server table was unavailable. */
export async function flushPendingReports() {
  const pending = readJson<PendingReport[]>(PENDING_KEY, []);
  if (!pending.length || !navigator.onLine) return;
  const left: PendingReport[] = [];
  for (const report of pending) { try { await sendReport(report); } catch { left.push(report); } }
  localStorage.setItem(PENDING_KEY, JSON.stringify(left));
}
async function submitReport(video: RelatedVideo, reason: string, details: string) {
  const report: PendingReport = { video_id: video.id, video_url: video.videoUrl, video_title: video.videoTitle || video.titleName || null, reason, details: details.trim() ? details.trim().slice(0, 500) : null };
  const markReported = () => localStorage.setItem(REPORTED_KEY, JSON.stringify([...new Set([video.id, ...readJson<string[]>(REPORTED_KEY, [])])].slice(0, 500)));
  try {
    await sendReport(report);
    markReported();
    return 'sent' as const;
  } catch {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...readJson<PendingReport[]>(PENDING_KEY, []), report].slice(-100)));
    markReported();
    return 'queued' as const;
  }
}

/* ---------------- Menu ---------------- */
type Props = {
  video: RelatedVideo;
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  playing: boolean;
  onPlay: () => void;
  saved: boolean;
  onToggleSave?: () => void;
};

/**
 * The menu renders in a portal on <body>, so it never clips inside the card's
 * overflow:hidden / content-visibility containers. Phones get an expanding bottom
 * sheet; wider screens get a popover anchored to the ••• button (flips up when needed).
 */
export function VideoActionMenu({ video, anchor, open, onClose, playing, onPlay, saved, onToggleSave }: Props) {
  const [view, setView] = useState<'menu' | 'report'>('menu');
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useBackLayer(open, () => { if (view === 'report') setView('menu'); else onClose(); });
  useEffect(() => { if (open) { setView('menu'); setDetails(''); setReason(REPORT_REASONS[0]); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia('(max-width: 700px)');
    const sync = () => setSheet(media.matches);
    sync(); media.addEventListener?.('change', sync);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { media.removeEventListener?.('change', sync); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  // Popover placement (desktop). Recomputed on scroll/resize so it stays attached.
  useLayoutEffect(() => {
    if (!open || sheet || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const w = panel?.offsetWidth || 260, h = panel?.offsetHeight || 280;
      let left = Math.min(window.innerWidth - w - 10, Math.max(10, rect.right - w));
      let top = rect.bottom + 6;
      if (top + h > window.innerHeight - 10) top = Math.max(10, rect.top - h - 6);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true, capture: true });
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, { capture: true } as EventListenerOptions); };
  }, [open, sheet, anchor, view]);

  // Lock page scroll behind the bottom sheet.
  useEffect(() => {
    if (!open || !sheet) return;
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, sheet]);

  useEffect(() => { if (open) window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button, textarea')?.focus(), 30); }, [open, view]);

  if (!open) return null;
  const title = video.videoTitle || video.titleName || 'Video';
  const direct = isDirectVideoFile(video.videoUrl);
  const already = hasReported(video.id);
  const run = (fn: () => void | Promise<void>) => () => { onClose(); void fn(); };
  const report = async () => {
    setSending(true);
    const result = await submitReport(video, reason, details);
    setSending(false);
    onClose();
    showToast(result === 'sent' ? 'Thanks. Your report was sent for review.' : 'Report saved. It will be sent automatically when the server is reachable.');
  };

  const body = view === 'menu' ? <>
    <div className="va-head"><strong>{title}</strong><span>{video.creatorName || providerName(video.videoUrl)}</span></div>
    <div className="va-list" role="menu">
      <button role="menuitem" onClick={run(onPlay)}>{playing ? <X size={18}/> : <Play size={18}/>}<span>{playing ? 'Close player' : 'Play here'}</span></button>
      {onToggleSave && <button role="menuitem" onClick={run(onToggleSave)}>{saved ? <BookmarkCheck size={18}/> : <Bookmark size={18}/>}<span>{saved ? 'Remove from Watch later' : 'Save to Watch later'}<small>{saved ? 'Saved in Library → Video' : 'Find it in Library → Video'}</small></span></button>}
      <button role="menuitem" onClick={run(() => shareLink(title, video.videoUrl))}><Share2 size={18}/><span>Share<small>Send the video link</small></span></button>
      <button role="menuitem" onClick={run(() => downloadVideo(video))}><Download size={18}/><span>Download<small>{direct ? 'Save the video file' : `Offline save in ${providerName(video.videoUrl)}`}</small></span>{!direct && <ExternalLink size={14} className="va-trail"/>}</button>
      <button role="menuitem" className="va-danger" onClick={() => already ? (onClose(), showToast('You already reported this video')) : setView('report')}><Flag size={18}/><span>Report<small>{already ? 'Already reported from this device' : 'Tell us what is wrong'}</small></span></button>
    </div>
  </> : <form className="va-report" onSubmit={event => { event.preventDefault(); void report(); }}>
    <div className="va-report-head"><button type="button" className="va-back" onClick={() => setView('menu')} aria-label="Back"><ChevronLeft size={18}/></button><strong>Report video</strong></div>
    <fieldset><legend>What is the problem?</legend>{REPORT_REASONS.map(item => <label key={item} className={reason === item ? 'active' : ''}><input type="radio" name="va-reason" value={item} checked={reason === item} onChange={() => setReason(item)}/>{item}</label>)}</fieldset>
    <textarea value={details} onChange={event => setDetails(event.target.value.slice(0, 500))} placeholder="Add details (optional)" rows={3}/>
    <div className="va-report-foot"><small>{details.length}/500</small><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={sending}>{sending ? 'Sending…' : 'Submit report'}</button></div>
  </form>;

  return createPortal(sheet
    ? <div className="va-layer" onClick={onClose}><div ref={panelRef} className="va-sheet" role="dialog" aria-modal="true" aria-label="Video options" onClick={event => event.stopPropagation()}><span className="va-grip" aria-hidden="true"/>{body}</div></div>
    : <div className="va-layer va-layer-clear" onClick={onClose}><div ref={panelRef} className="va-popover" role="dialog" aria-label="Video options" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }} onClick={event => event.stopPropagation()}>{body}</div></div>,
  document.body);
}
