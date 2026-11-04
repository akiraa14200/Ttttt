import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { MessageCircle, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

type CommentRow = {
  id: string; title_id: string; user_id: string; parent_comment_id: string | null;
  body: string; media_url: string | null; created_at: string;
  author?: { username?: string; display_name?: string; avatar_url?: string };
};

export function AnimeComments({ animeId, animeTitle, user }: { animeId: string; animeTitle: string; user: User | null }) {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError('');
    const { data, error: queryError } = await supabase.from('community_comments')
      .select('id,title_id,user_id,parent_comment_id,body,media_url,created_at')
      .eq('title_id', animeId).order('created_at', { ascending: false }).limit(100);
    if (queryError) { setError(queryError.message); setRows([]); setLoading(false); return; }
    const comments = (data || []) as CommentRow[];
    const ids = [...new Set(comments.map(row => row.user_id))];
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', ids);
      const byId = new Map((profiles || []).map(profile => [profile.id, profile]));
      comments.forEach(row => { row.author = byId.get(row.user_id); });
    }
    setRows(comments); setLoading(false);
  };
  useEffect(() => { void load(); }, [animeId]);

  const post = async (event: FormEvent, body: string, parentId: string | null) => {
    event.preventDefault();
    if (!user || !body.trim()) return;
    setBusy(true); setError('');
    const { error: insertError } = await supabase.from('community_comments').insert({
      title_id: animeId, user_id: user.id, body: body.trim(), parent_comment_id: parentId
    });
    if (insertError) setError(insertError.message);
    else { if (parentId) setReplyDraft(''); else setDraft(''); setReplyTo(null); await load(); }
    setBusy(false);
  };

  return <section className="anime-comments">
    <div className="section-head"><div><h2>Community discussion</h2><p>Join the conversation about {animeTitle}.</p></div><span>{rows.length} comments</span></div>
    {user ? <form className="anime-comment-compose" onSubmit={event => void post(event, draft, null)}>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Share your thoughts…" maxLength={3000} required/>
      <button className="primary-btn" disabled={busy || !draft.trim()}><Send size={15}/> Post comment</button>
    </form> : <div className="entry-empty"><MessageCircle size={20}/> Sign in to join the discussion.</div>}
    {error && <p className="anime-comment-error">{error}</p>}
    {loading ? <p>Loading discussion…</p> : rows.length ? <div className="anime-comment-list">{rows.filter(row => !row.parent_comment_id).map(row => <article className="anime-comment" key={row.id}>
      <div className="anime-comment-main"><div className="anime-comment-meta"><strong>{row.author?.display_name || 'Reader'}</strong><span>@{row.author?.username || 'reader'}</span><time>{new Date(row.created_at).toLocaleDateString()}</time></div>
        <p className="anime-comment-body">{row.body}</p>
        {user && <button className="anime-comment-reply" onClick={() => { setReplyTo(replyTo === row.id ? null : row.id); setReplyDraft(''); }}>Reply</button>}
        {replyTo === row.id && <form className="anime-reply-form" onSubmit={event => void post(event, replyDraft, row.id)}><textarea value={replyDraft} onChange={event => setReplyDraft(event.target.value)} placeholder="Write a reply…" maxLength={3000} required/><button className="primary-btn" disabled={busy || !replyDraft.trim()}>Send reply</button></form>}
        {rows.filter(child => child.parent_comment_id === row.id).map(child => <div className="anime-comment-child" key={child.id}><strong>{child.author?.display_name || 'Reader'}</strong><p>{child.body}</p></div>)}
      </div>
    </article>)}</div> : <div className="entry-empty">No comments yet. Start the discussion.</div>}
  </section>;
}
