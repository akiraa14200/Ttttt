import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useLocation, type Location } from 'react-router-dom';
import { Search, Compass, Bookmark, ShieldCheck, Play, Star, ChevronRight, ArrowLeft, Heart, Clock3, Menu, X, ExternalLink, Sparkles, Tv, Info, Users, FileText, Globe, Youtube, ChevronDown, RotateCw, MessageCircle, Home as HomeIcon, UserRound, ChevronLeft, Shuffle, Minus, Plus, Settings, Trash2, Clock } from 'lucide-react';
// The application UI and page components are defined below.
import { Anime, AnimeCharacter, getAnime, peekAnime, rememberPreviews, applyCachedVideoMetadata, enrichVideoMetadataProgressive, getAnimeCharacters, getPopular, getPopularManga, getSeasonal, getTrending, getTrendingManga, getRelatedVideos, RelatedVideo, imageOf, searchAnime, titleOf } from './lib/catalogue';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { AnimeComments } from './components/AnimeComments';
import { AdminWorkspace } from './components/AdminWorkspace';
import './components/admin-workspace.css';
import { useAmbientGlow } from './components/AmbientGlow';
import { youtubeAmbientFrames } from './lib/ambient';
import { RichText } from './components/RichText';
import { readPersisted, writePersisted } from './lib/persist';
import { isAmbientEnabled, setAmbientEnabled } from './lib/ambient';
import { VideoActionMenu, flushPendingReports } from './components/VideoActions';
import { useAppBackNavigation, useBackLayer } from './lib/backNav';
import { ToastHost, OfflineBanner, ShareButton, formatCountdown, useNow, showToast, readRecentSearches, pushRecentSearch, clearRecentSearches } from './components/Extras';
import './components/extras.css';

/** Calls onReach when the returned element scrolls near the viewport (infinite loading). */
function useNearViewport(onReach: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const callback = useRef(onReach);
  callback.current = onReach;
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) callback.current(); }, { rootMargin: '900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

/** Deterministic 0..1 value per id for this app session: feeds feel random but never reshuffle while you scroll. */
const SESSION_SEED = Math.floor(Math.random() * 1e9);
const stableRandom = (id: string) => {
  let h = 2166136261 ^ SESSION_SEED;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
};

/** True while the bottom-navigation tab that owns this subtree is the visible one. */
const TabActiveContext = createContext(true);
const useTabActive = () => useContext(TabActiveContext);

type StoredProgress = { id: string; title: string; image: string; progress: number; updated: number };
const readStore = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

function Header({ user, isAdmin, onSignOut }: { user: User | null; isAdmin: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useBackLayer(open, () => setOpen(false));
  const submit = (event: FormEvent) => { event.preventDefault(); navigate(term.trim() ? `/search?q=${encodeURIComponent(term.trim())}` : '/search'); setOpen(false); };
  return <header className="topbar"><div className="nav-wrap">
    <Link to="/" className="brand"><img className="brand-mark brand-logo" src="/logo-192.png" alt="" width="31" height="31"/><span>RYKOCOLLECTION</span></Link>
    <nav className={open ? 'nav-links open' : 'nav-links'}>
      <Link to="/"><Compass size={16}/> Discover</Link><Link to="/search">Explore</Link><Link to="/watchlist"><Bookmark size={16}/> My list</Link><Link to="/video"><Tv size={16}/> Video</Link><Link to="/privacy"><ShieldCheck size={16}/> Privacy</Link>{isAdmin && <Link to="/admin"><ShieldCheck size={16}/> Admin workspace</Link>}
    </nav>
    <form className="nav-search" onSubmit={submit}><Search size={17}/><input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search anime..." aria-label="Search anime"/><kbd>↵</kbd></form>
    {user && <div className="nav-account"><span>{String(user.user_metadata?.display_name || "Reader")}</span><button onClick={onSignOut}>Sign out</button></div>}
    <button className="icon-btn mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X/> : <Menu/>}</button>
  </div></header>;
}

function AnimeCard({ anime, onSave, saved }: { anime: Anime; onSave: (anime: Anime) => void; saved: boolean }) {
  return <article className="anime-card">
    <Link to={`/anime/${anime.id}`} className="poster-wrap">
      <img src={imageOf(anime)} alt={titleOf(anime)} loading="lazy" decoding="async"/>
      <span className="poster-format">{anime.format || 'ANIME'}</span>
      {anime.averageScore ? <span className="poster-score"><Star size={12} fill="currentColor"/> {(anime.averageScore / 10).toFixed(1)}</span> : null}
      {anime.nextAiringEpisode?.airingAt && anime.nextAiringEpisode.airingAt * 1000 > Date.now() ? <span className="poster-airing"><Clock size={11}/> EP {anime.nextAiringEpisode.episode} · {formatCountdown(anime.nextAiringEpisode.airingAt)}</span> : null}
    </Link>
    <div className="card-meta"><div className="card-title-row"><Link to={`/anime/${anime.id}`} className="card-title">{titleOf(anime)}</Link><button className={saved ? 'save-mini saved' : 'save-mini'} onClick={() => onSave(anime)} aria-label={saved ? 'Remove from watchlist' : 'Add to watchlist'}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'}/></button></div><p>{anime.seasonYear || 'Year unknown'} <span>·</span> {anime.episodes ? `${anime.episodes} eps` : 'Ongoing'}</p></div>
  </article>;
}

function Section({ title, subtitle, items, saved, onSave, to }: { title: string; subtitle?: string; items: Anime[]; saved: string[]; onSave: (anime: Anime) => void; to?: string }) {
  if (!items.length) return null;
  return <section className="section"><div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{to && <Link to={to} className="text-link">View all <ChevronRight size={16}/></Link>}</div><div className="anime-grid">{items.map(item => <AnimeCard key={item.id} anime={item} saved={saved.includes(item.id)} onSave={onSave}/>)}</div></section>;
}

function useLibrary() {
  const [saved, setSaved] = useState<Anime[]>(() => readStore<Anime[]>('kairo-watchlist', []));
  const [history, setHistory] = useState<StoredProgress[]>(() => readStore<StoredProgress[]>('kairo-history', []));
  const [statuses, setStatuses] = useState<Record<string, 'Watching' | 'Plan to Watch' | 'Completed' | 'Waiting'>>(() => readStore('rykoc-library-status', {}));
  const [progress, setProgressMap] = useState<Record<string, number>>(() => readStore('rykoc-library-progress', {}));
  const [savedVideos, setSavedVideos] = useState<RelatedVideo[]>(() => readStore<RelatedVideo[]>('rykoc-saved-videos', []));
  // Several pages stay mounted at once (tab keep-alive), so each copy of this hook
  // writes only real changes and picks up changes made by the others.
  const persist = (key: string, value: unknown) => {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) === next) return;
    localStorage.setItem(key, next);
    window.dispatchEvent(new CustomEvent('rykoc-library-change', { detail: key }));
  };
  useEffect(() => persist('kairo-watchlist', saved), [saved]);
  useEffect(() => persist('kairo-history', history), [history]);
  useEffect(() => persist('rykoc-library-status', statuses), [statuses]);
  useEffect(() => persist('rykoc-library-progress', progress), [progress]);
  useEffect(() => persist('rykoc-saved-videos', savedVideos), [savedVideos]);
  const current = useRef({ saved, history, statuses, progress, savedVideos });
  current.current = { saved, history, statuses, progress, savedVideos };
  useEffect(() => {
    const changed = (key: string, value: unknown) => { const raw = localStorage.getItem(key); return raw !== null && raw !== JSON.stringify(value); };
    const sync = () => {
      if (changed('kairo-watchlist', current.current.saved)) setSaved(readStore<Anime[]>('kairo-watchlist', []));
      if (changed('kairo-history', current.current.history)) setHistory(readStore<StoredProgress[]>('kairo-history', []));
      if (changed('rykoc-library-status', current.current.statuses)) setStatuses(readStore('rykoc-library-status', {}));
      if (changed('rykoc-library-progress', current.current.progress)) setProgressMap(readStore('rykoc-library-progress', {}));
      if (changed('rykoc-saved-videos', current.current.savedVideos)) setSavedVideos(readStore<RelatedVideo[]>('rykoc-saved-videos', []));
    };
    window.addEventListener('rykoc-library-change', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('rykoc-library-change', sync); window.removeEventListener('storage', sync); };
  }, []);
  const toggle = (anime: Anime) => setSaved(old => old.some(item => item.id === anime.id) ? old.filter(item => item.id !== anime.id) : [anime, ...old]);
  const remember = (anime: Anime) => setHistory(old => [{ id: anime.id, title: titleOf(anime), image: imageOf(anime), progress: 0, updated: Date.now() }, ...old.filter(item => item.id !== anime.id)].slice(0, 20));
  const setLibraryStatus = (id: string, status: 'Watching' | 'Plan to Watch' | 'Completed' | 'Waiting') => setStatuses(old => ({ ...old, [id]: status }));
  const setProgress = (id: string, value: number, max?: number) => setProgressMap(old => ({ ...old, [id]: Math.max(0, Math.min(max && max > 0 ? max : 9999, Math.round(value))) }));
  const toggleVideo = (video: RelatedVideo) => {
    const exists = current.current.savedVideos.some(item => item.id === video.id);
    showToast(exists ? 'Removed from Watch later' : 'Saved to Watch later');
    setSavedVideos(old => old.some(item => item.id === video.id) ? old.filter(item => item.id !== video.id) : [video, ...old].slice(0, 200));
  };
  return { saved, history, toggle, remember, statuses, setLibraryStatus, progress, setProgress, savedVideos, toggleVideo };
}

type HomeSnapshot = { trending: Anime[]; popular: Anime[]; seasonal: Anime[]; trendingManga: Anime[]; popularManga: Anime[] };
const HOME_CACHE_KEY = 'home';
const HOME_CACHE_AGE = 24 * 60 * 60 * 1000;

function Home() {
  // Stale-while-revalidate: show the last good catalogue instantly, then refresh it.
  const [snapshot] = useState(() => { const value = readPersisted<HomeSnapshot>(HOME_CACHE_KEY, HOME_CACHE_AGE); if (value) Object.values(value).forEach(rememberPreviews); return value; });
  const [trending, setTrending] = useState<Anime[]>(snapshot?.trending || []);
  const [popular, setPopular] = useState<Anime[]>(snapshot?.popular || []);
  const [seasonal, setSeasonal] = useState<Anime[]>(snapshot?.seasonal || []);
  const [trendingManga, setTrendingMangaItems] = useState<Anime[]>(snapshot?.trendingManga || []);
  const [popularManga, setPopularMangaItems] = useState<Anime[]>(snapshot?.popularManga || []);
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState('');
  const { saved, history, toggle } = useLibrary();
  useEffect(() => {
    let active = true;
    // Each section appears as soon as its own data arrives; one failing source no longer blanks the page.
    const sources: [keyof HomeSnapshot, () => Promise<Anime[]>, (items: Anime[]) => void][] = [
      ['trending', getTrending, setTrending], ['popular', getPopular, setPopular], ['seasonal', getSeasonal, setSeasonal],
      ['trendingManga', getTrendingManga, setTrendingMangaItems], ['popularManga', getPopularManga, setPopularMangaItems]
    ];
    const fresh: Partial<HomeSnapshot> = {};
    Promise.allSettled(sources.map(([key, load, set]) => load().then(items => {
      if (!active) return;
      fresh[key] = items;
      if (items.length || !snapshot?.[key]?.length) set(items);
      setLoading(false);
    }))).then(results => {
      if (!active) return;
      setLoading(false);
      const failed = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
      if (failed.length === results.length && !snapshot) setError(failed[0].reason instanceof Error ? failed[0].reason.message : 'Could not load anime right now.');
      else setError('');
      if (!failed.length) writePersisted(HOME_CACHE_KEY, fresh);
      else if (Object.keys(fresh).length) writePersisted(HOME_CACHE_KEY, { ...(snapshot || {}), ...fresh });
    });
    return () => { active = false; };
  }, []);
  const [heroIndex, setHeroIndex] = useState(0);
  const featured = trending.slice(0, 5);
  const hero = featured[heroIndex] || trending[0];
  const tabActive = useTabActive();
  useEffect(() => {
    if (featured.length < 2 || !tabActive) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setHeroIndex(index => (index + 1) % featured.length);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [featured.length, tabActive]);
  return <main className="page-shell">
    {hero && <section className="hero" aria-label="Featured anime carousel">
      <img className="hero-banner-image" src={hero.bannerImage || imageOf(hero)} alt="" fetchPriority="high" decoding="async"/>
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={14}/> YOUR NEXT FAVORITE STARTS HERE</span><h1>Find your next<br/><em>anime obsession.</em></h1><p>Explore stories worth getting lost in. Discover trending series, seasonal gems and timeless favorites.</p><div className="hero-actions"><Link className="primary-btn" to={hero ? `/anime/${hero.id}` : '/search'}><Play size={16} fill="currentColor"/> Explore featured</Link><Link className="secondary-btn" to="/search">Browse library <ChevronRight size={16}/></Link></div><div className="hero-featured">{hero && <><span>FEATURED PICK · {heroIndex + 1}/5</span><strong>{titleOf(hero)}</strong></>}</div><div className="hero-carousel-controls"><button aria-label="Previous featured anime" onClick={() => setHeroIndex(i => (i + 4) % Math.max(1, featured.length))}><ChevronLeft size={16}/></button>{featured.map((item,index)=><button key={item.id} aria-label={`Show ${titleOf(item)}`} className={index===heroIndex?"active":""} onClick={()=>setHeroIndex(index)} />)}<button aria-label="Next featured anime" onClick={() => setHeroIndex(i => (i + 1) % Math.max(1, featured.length))}><ChevronRight size={16}/></button></div></div>
    </section>}
    {!hero && <div className="hero hero-loading"><div className="hero-copy"><span className="eyebrow">RYKOCOLLECTION ANIME DISCOVERY</span><h1>Stories that stay<br/><em>with you.</em></h1><p>Find your next anime, one discovery at a time.</p><Link className="primary-btn" to="/search">Explore anime <ChevronRight size={16}/></Link></div></div>}
    {error && <div className="notice"><strong>Catalogue unavailable.</strong> {error} Check your connection and try again.</div>}
    {loading && <div className="section"><div className="section-head"><h2>Finding something great</h2></div><div className="anime-grid">{Array.from({length: 6}, (_,i) => <div className="skeleton-card" key={i}><div className="skeleton-poster"/><div className="skeleton-line"/></div>)}</div></div>}
    <Section title="Trending now" subtitle="What the anime community is watching" items={trending} saved={saved.map(a => a.id)} onSave={toggle} to="/search?sort=trending"/>
    <Section title="This season" subtitle="Fresh stories airing right now" items={seasonal} saved={saved.map(a => a.id)} onSave={toggle}/>
    <Section title="Popular picks" subtitle="Fan favorites worth your time" items={popular} saved={saved.map(a => a.id)} onSave={toggle}/>
    <Section title="Trending manga & manhwa" subtitle="Popular manga, manhwa and manhua from AniList" items={trendingManga} saved={saved.map(a => a.id)} onSave={toggle} to="/search?format=Manga"/>
    <Section title="Popular manga" subtitle="Reader favorites across the AniList catalogue" items={popularManga} saved={saved.map(a => a.id)} onSave={toggle} to="/search?format=Manga"/>
    {history.length > 0 && <section className="section"><div className="section-head"><div><h2>Pick up where you left off</h2><p>Your recently opened anime</p></div></div><div className="history-row">{history.slice(0,5).map(item => <Link to={`/anime/${item.id}`} className="history-item" key={item.id}><img src={item.image} alt=""/><span>{item.title}</span><small>Recently viewed</small></Link>)}</div></section>}
    <div className="api-credit">Catalogue powered by the RykoCollection website database.</div>
  </main>;
}

function SearchPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [term, setTerm] = useState(params.get('q') || '');
  const [genre, setGenre] = useState('');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState('');
  const sortFromParam = (value: string | null) => value === 'trending' ? 'TRENDING_DESC' : value === 'score' ? 'SCORE_DESC' : value === 'newest' ? 'START_DATE_DESC' : value === 'popular' ? 'POPULARITY_DESC' : '';
  const [sort, setSort] = useState(() => sortFromParam(params.get('sort')));
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches());
  const navigate = useNavigate();
  const [items, setItems] = useState<Anime[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const { saved, toggle } = useLibrary();
  useEffect(() => { setTerm(params.get('q') || ''); setFormat(params.get('format') || ''); if (params.has('sort')) setSort(sortFromParam(params.get('sort'))); }, [location.search]);
  // Remember a search once the user pauses typing and it returned results.
  useEffect(() => {
    if (!term.trim() || busy || !items.length) return;
    const timer = window.setTimeout(() => setRecent(pushRecentSearch(term)), 1500);
    return () => window.clearTimeout(timer);
  }, [term, busy, items.length]);
  const surprise = () => {
    const pool = items.length ? items : [];
    if (!pool.length) { showToast('Nothing loaded yet'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    rememberPreviews([pick]);
    navigate(`/anime/${pick.id}`);
  };
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true); setError(''); setPage(1); setHasMore(true);
      searchAnime(term.trim(), 1, genre || undefined, status || undefined, format || undefined, sort || undefined)
        .then(data => { if (active) { setItems(data); setHasMore(data.length === 50); } })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Search failed.'); })
        .finally(() => { if (active) setBusy(false); });
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [term, genre, status, format, sort]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true); setError('');
    const next = page + 1;
    try {
      const data = await searchAnime(term.trim(), next, genre || undefined, status || undefined, format || undefined, sort || undefined);
      setItems(old => { const ids = new Set(old.map(item => item.id)); return [...old, ...data.filter(item => !ids.has(item.id))]; });
      setPage(next); setHasMore(data.length === 50);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load more titles.'); }
    finally { setLoadingMore(false); }
  };
  const searchSentinel = useNearViewport(() => { void loadMore(); }, hasMore && !busy && !loadingMore && !error && items.length > 0);
  const genres = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Supernatural'];
  return <main className="content-page browse-page"><div className="page-heading"><span className="eyebrow">THE ANILIST CATALOGUE</span><h1>Explore <em>anime & manga.</em></h1><p>Search across anime, manga, manhwa, manhua and light novels.</p></div>
    <div className="filter-bar browse-filters"><label className="large-search"><Search size={19}/><input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search titles, series, stories..." autoComplete="off"/></label>
      <div className="browse-filter-selects"><label className="genre-select"><span>Genre</span><select aria-label="Filter by genre" value={genre} onChange={e => setGenre(e.target.value)}><option value="">All genres</option>{genres.map(g => <option key={g}>{g}</option>)}</select></label>
      <label className="genre-select"><span>Status</span><select aria-label="Filter by status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Any status</option><option value="RELEASING">Airing</option><option value="FINISHED">Finished</option><option value="NOT_YET_RELEASED">Upcoming</option><option value="HIATUS">Hiatus</option></select></label>
      <label className="genre-select"><span>Format</span><select aria-label="Filter by format" value={format} onChange={e=>setFormat(e.target.value)}><option value="">Any format</option><option value="Anime">Anime</option><option value="Manga">Manga</option><option value="Manhwa">Manhwa</option><option value="Manhua">Manhua</option><option value="Movie">Movie</option><option value="TV Series">TV Series</option><option value="Light Novel">Light Novel</option><option value="Web Novel">Web Novel</option></select></label>
      <label className="genre-select"><span>Sort</span><select aria-label="Sort results" value={sort} onChange={e=>setSort(e.target.value)}><option value="">{term.trim() ? 'Best match' : 'Most popular'}</option><option value="TRENDING_DESC">Trending</option><option value="SCORE_DESC">Top rated</option><option value="START_DATE_DESC">Newest</option><option value="FAVOURITES_DESC">Most favourited</option></select></label></div>
    </div>
    {recent.length > 0 && <div className="recent-searches" aria-label="Recent searches"><span><Clock size={13}/> Recent</span>{recent.map(value => <button key={value} type="button" className={value.toLowerCase()===term.trim().toLowerCase()?'active':''} onClick={()=>setTerm(value)}>{value}</button>)}<button type="button" className="recent-clear" onClick={()=>{clearRecentSearches();setRecent([]);}} aria-label="Clear recent searches"><X size={13}/></button></div>}
    <div className="browse-results-head"><div className="results-caption">{busy ? 'Updating catalogue…' : `${items.length} AniList titles loaded`}{term && <span> for “{term}”</span>}</div><button type="button" className="secondary-btn surprise-btn" onClick={surprise} disabled={!items.length}><Shuffle size={15}/> Surprise me</button></div>
    {error && <div className="notice">{error}</div>}
    {busy && !items.length ? <div className="anime-grid">{Array.from({length:8},(_,i)=><div className="skeleton-card" key={i}><div className="skeleton-poster"/><div className="skeleton-line"/></div>)}</div> :
      items.length ? <><div className="anime-grid">{items.map(item=><AnimeCard key={item.id} anime={item} saved={saved.some(a=>a.id===item.id)} onSave={toggle}/>)}</div>{hasMore && <div className="load-more-wrap" ref={searchSentinel}><button className="secondary-btn load-more-btn" onClick={loadMore} disabled={loadingMore}>{loadingMore?'Loading more titles…':'Load more titles'}</button></div>}</> :
      <div className="empty-state"><Search size={28}/><h3>No anime or manga found</h3><p>Try another title or choose a different filter.</p></div>}
  </main>;
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatReleaseDate(date?: { year?: number; month?: number; day?: number }, fallbackYear?: number) {
  if (!date?.year) return fallbackYear ? String(fallbackYear) : 'Not announced';
  if (!date.month) return String(date.year);
  return [date.day, MONTHS[date.month - 1], date.year].filter(Boolean).join(' ');
}
/** "NOT_YET_RELEASED" → "Not yet released"; already-friendly values ("Ongoing") are kept. */
function prettyEnum(value?: string) {
  if (!value) return '';
  if (!/^[A-Z0-9_]+$/.test(value)) return value;
  const text = value.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
function countryName(code?: string) {
  if (!code) return '';
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try { return regionNames?.of(code) || code; } catch { return code; }
}
/** AniList often lists the same site several times (one per language); show each once, labelled. */
function uniqueSourceLinks(links: { url: string; site: string; language?: string }[]) {
  const seenUrl = new Set<string>(); const counts = new Map<string, number>();
  const valid = links.filter(link => link.url?.startsWith('https://') && !seenUrl.has(link.url) && !!seenUrl.add(link.url));
  valid.forEach(link => counts.set(link.site, (counts.get(link.site) || 0) + 1));
  const seenLabel = new Set<string>();
  return valid.map(link => ({ url: link.url, label: (counts.get(link.site) || 0) > 1 && link.language ? `${link.site || 'External source'} (${link.language})` : link.site || 'External source' }))
    .filter(link => !seenLabel.has(link.label) && !!seenLabel.add(link.label)).slice(0, 14);
}

function DetailPage({ user }: { user: User | null }) {
  const { id } = useParams();
  const [anime, setAnime] = useState<Anime | null>(() => peekAnime(id || ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'characters' | 'details' | 'comments'>('overview');
  const [selectedCharacter, setSelectedCharacter] = useState<AnimeCharacter | null>(null);
  const [characterPage, setCharacterPage] = useState(1);
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [characterError, setCharacterError] = useState('');
  const { saved, toggle, remember } = useLibrary();
  const [showPlayer, setShowPlayer] = useState(false);
  const [source, setSource] = useState('');
  const now = useNow(30_000);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setAnime(peekAnime(id || '')); setActiveTab('overview'); setSelectedCharacter(null); setCharacterPage(1);
    const animeId = id || '';
    getAnime(animeId)
      .then(data => { if (active) { setAnime(current => data || current); if (!data) setError('AniList could not find this entry.'); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load anime metadata.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, attempt]);

  const loadMoreCharacters = async () => {
    if (!anime?.characters?.pageInfo.hasNextPage || loadingCharacters) return;
    const nextPage = characterPage + 1;
    setLoadingCharacters(true); setCharacterError('');
    try {
      const result = await getAnimeCharacters(anime.id, nextPage);
      setAnime(current => current ? {
        ...current,
        characters: {
          pageInfo: result.pageInfo,
          edges: [...(current.characters?.edges || []), ...result.edges.filter(edge => !(current.characters?.edges || []).some(old => old.node.id === edge.node.id))]
        }
      } : current);
      setCharacterPage(nextPage);
    } catch (e) {
      setCharacterError(e instanceof Error ? e.message : 'Could not load more characters.');
    } finally { setLoadingCharacters(false); }
  };

  // With a preview from the card that was tapped, the page renders immediately; only a cold open shows the skeleton.
  if (loading && !anime) return <main className="content-page"><div className="detail-skeleton"/><p className="metadata-loading-note">Loading entry information and character data…</p></main>;
  if (!anime) return <main className="content-page"><div className="empty-state"><h2>Entry unavailable</h2><p>{error || 'This title may no longer be available.'}</p><button className="secondary-btn" onClick={() => setAttempt(value => value + 1)}><RotateCw size={15}/> Try again</button><Link className="secondary-btn" to="/search">Back to explore</Link></div></main>;

  const isSaved = saved.some(a => a.id === anime.id);
  const start = () => { remember(anime); setShowPlayer(true); };
  const trailerId = anime.trailer?.site?.toLowerCase() === 'youtube' && /^[a-zA-Z0-9_-]{6,}$/.test(anime.trailer.id) ? anime.trailer.id : null;
  const staff = anime.staff?.edges || [];
  const authors = staff.filter(item => /author|writer|original creator|story/i.test(item.role)).map(item => item.node.name.full).filter(Boolean);
  const artists = staff.filter(item => /artist|illustrat|character design|art direction|story & art/i.test(item.role)).map(item => item.node.name.full).filter(Boolean);
  const releaseDate = formatReleaseDate(anime.startDate, anime.seasonYear);
  const statusLabel = prettyEnum(anime.status);
  const pending = loading ? 'Loading…' : '';
  const sourceLinks = uniqueSourceLinks(anime.externalLinks || []);
  const sourceName = anime.source?.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase()) || 'Not specified';
  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: <Info size={16}/> },
    { id: 'characters' as const, label: 'Characters', icon: <Users size={16}/>, count: anime.characters?.edges.length },
    { id: 'details' as const, label: 'Details', icon: <FileText size={16}/> },
    { id: 'comments' as const, label: 'Comments', icon: <MessageCircle size={16}/> }
  ];

  return <main className="detail-page">
    <div className="detail-backdrop" style={{backgroundImage:`linear-gradient(0deg,#000 0%,rgba(0,0,0,.74) 100%),url(${anime.bannerImage || imageOf(anime)})`}}/>
    <div className="detail-content">
      <Link to="/search" className="back-link"><ArrowLeft size={16}/> Back to explore</Link>
      <div className="detail-main">
        <img className="detail-poster" src={imageOf(anime) || '/placeholder-poster.svg'} alt={titleOf(anime)} onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/>
        <div className="detail-info">
          <span className="eyebrow">{anime.format || 'ANIME'} {anime.seasonYear ? `· ${anime.seasonYear}` : ''}</span>
          <h1>{titleOf(anime)}</h1>
          {anime.title.native && <p className="native-title">{anime.title.native}</p>}
          <div className="detail-stats">
            {anime.averageScore ? <span><Star size={15} fill="currentColor"/> {(anime.averageScore/10).toFixed(1)} / 10</span> : null}
            <span><Play size={14}/> {anime.episodes ?? '—'} episodes</span>
            <span><Clock3 size={14}/> {statusLabel || 'Unknown status'}</span>
            {anime.nextAiringEpisode?.airingAt && anime.nextAiringEpisode.airingAt * 1000 > now ? <span className="detail-airing"><Clock size={14}/> Episode {anime.nextAiringEpisode.episode} in {formatCountdown(anime.nextAiringEpisode.airingAt, now)}</span> : null}
          </div>
          <div className="genre-tags">{anime.genres?.map(g=><span key={g}>{g}</span>)}</div>
          <div className="hero-actions">
            <button className="primary-btn" onClick={start}><Play size={16} fill="currentColor"/> Open player</button>
            <button className="secondary-btn" onClick={()=>toggle(anime)}>{isSaved ? <Heart size={16} fill="currentColor"/> : <Bookmark size={16}/>} {isSaved ? 'In my list' : 'Add to list'}</button>
            {anime.siteUrl && <a className="secondary-btn" href={anime.siteUrl} target="_blank" rel="noreferrer">AniList <ExternalLink size={14}/></a>}
            <ShareButton title={titleOf(anime)} url={anime.siteUrl || window.location.href}/>
          </div>
        </div>
      </div>

      <div className="entry-tabs" role="tablist" aria-label="Anime entry sections">
        {tabs.map(tab=><button key={tab.id} type="button" role="tab" aria-selected={activeTab===tab.id} className={activeTab===tab.id?'entry-tab active':'entry-tab'} onClick={()=>{setActiveTab(tab.id);setSelectedCharacter(null);}}>
          {tab.icon}<span>{tab.label}</span>{tab.id==='characters' && typeof tab.count==='number' && <small>{tab.count}{anime.characters?.pageInfo.hasNextPage?'+':''}</small>}
        </button>)}
      </div>

      {activeTab === 'overview' && <section className="entry-panel overview-panel">
        <div className="entry-section-heading"><span className="eyebrow">THE STORY</span><h2>Overview</h2></div>
        <div className="overview-description"><RichText text={anime.description} fallback={loading ? 'Loading description…' : 'No description is available for this entry yet.'}/></div>
        <div className="overview-trailer">
          <div className="entry-section-heading"><span className="eyebrow">OFFICIAL PREVIEW</span><h2>Trailer</h2></div>
          {trailerId ? <TrailerFrame trailerId={trailerId} title={`Trailer for ${titleOf(anime)}`}/> :
            <div className="entry-empty"><Youtube size={22}/><span>No supported trailer is listed for this entry.</span>{anime.siteUrl && <a href={anime.siteUrl} target="_blank" rel="noreferrer">Check entry sources <ExternalLink size={13}/></a>}</div>}
        </div>
      </section>}

      {activeTab === 'overview' && anime.relatedVideos && anime.relatedVideos.length > 0 && <section className="entry-panel related-videos-panel">
        <div className="entry-section-heading"><span className="eyebrow">FROM THE RYKO CATALOGUE</span><h2>Related videos <small>{anime.relatedVideos.length}</small></h2><p>Videos you added to this title on your website.</p></div>
        <div className="video-trailer-grid">{anime.relatedVideos.map(video=><a key={video.id} className="video-trailer-card" href={video.videoUrl} target="_blank" rel="noopener noreferrer"><span className="video-trailer-image"><img src={imageOf(anime)} alt="" loading="lazy"/><span className="video-play-icon"><Play size={19} fill="currentColor"/></span></span><span className="video-trailer-title">{video.videoTitle || titleOf(anime)}</span><span className="video-trailer-meta">{video.platform} · {video.creatorName || 'Related video'}</span></a>)}</div>
      </section>}

      {activeTab === 'characters' && <section className="entry-panel characters-panel">
        <div className="entry-section-heading"><span className="eyebrow">CAST & PROFILES</span><h2>Characters <small>{anime.characters?.edges.length || 0}{anime.characters?.pageInfo.hasNextPage?'+':''}</small></h2><p>Select a character to open their profile.</p></div>
        {loading && !anime.characters?.edges.length ? <div className="entry-character-grid" aria-label="Loading characters">{Array.from({length:8},(_,i)=><div className="skeleton-card" key={i}><div className="skeleton-poster"/><div className="skeleton-line"/></div>)}</div> : anime.characters?.edges.length ? <div className="entry-character-grid">{anime.characters.edges.map(({node,role})=><button className="entry-character-card" key={node.id} onClick={()=>setSelectedCharacter(node)}>
          <img src={node.image?.large || node.image?.medium || ''} alt={node.name.full || 'Character'} loading="lazy" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>
          <span className="entry-character-name">{node.name.full || 'Unknown character'}</span><small>{role || 'Character'}</small>
        </button>)}</div> : <div className="entry-empty"><Users size={22}/><span>Character information is not available for this entry yet.</span></div>}
        {characterError && <p className="metadata-error">{characterError}</p>}
        {anime.characters?.pageInfo.hasNextPage && <button className="secondary-btn load-characters-btn" onClick={loadMoreCharacters} disabled={loadingCharacters}>{loadingCharacters?'Loading…':'Load more characters'} <ChevronDown size={15}/></button>}
        {selectedCharacter && <div className="character-modal-backdrop" role="presentation" onClick={()=>setSelectedCharacter(null)}>
          <section className="character-modal character-profile-modal" role="dialog" aria-modal="true" aria-label={selectedCharacter.name.full || 'Character details'} onClick={event=>event.stopPropagation()}>
            <button className="character-modal-close" onClick={()=>setSelectedCharacter(null)} aria-label="Close character details"><X size={18}/></button>
            <div className="character-modal-top character-profile-header">
              <img src={selectedCharacter.image?.large || selectedCharacter.image?.medium || ''} alt={selectedCharacter.name.full || 'Character'} loading="lazy" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>
              <div className="character-profile-heading">
                <span className="eyebrow">CHARACTER PROFILE</span>
                <h2>{selectedCharacter.name.full || 'Unknown character'}</h2>
                {selectedCharacter.name.native && <p className="character-native-name">{selectedCharacter.name.native}</p>}
                <span className="character-role">{anime.characters?.edges.find(edge=>edge.node.id===selectedCharacter.id)?.role || selectedCharacter.role || 'Character'}</span>
                {!!selectedCharacter.name.alternative?.length && <p className="character-aliases">Also known as: {selectedCharacter.name.alternative.join(' · ')}</p>}
              </div>
            </div>
            <section className="character-profile-section">
              <div className="character-profile-section-title"><span>01</span><h3>Profile information</h3></div>
              <div className="character-facts character-facts-grid">
                <span><strong>Gender</strong>{selectedCharacter.gender || 'Not listed'}</span>
                <span><strong>Age</strong>{selectedCharacter.age || 'Not listed'}</span>
                <span><strong>Birthday</strong>{selectedCharacter.dateOfBirth && (selectedCharacter.dateOfBirth.month || selectedCharacter.dateOfBirth.day) ? [selectedCharacter.dateOfBirth.month,selectedCharacter.dateOfBirth.day].filter(Boolean).join('/') : 'Not listed'}</span>
                <span><strong>Favorites</strong>{typeof selectedCharacter.favourites === 'number' ? selectedCharacter.favourites.toLocaleString() : 'Not listed'}</span>
              </div>
            </section>
            <section className="character-profile-section">
              <div className="character-profile-section-title"><span>02</span><h3>Biography</h3></div>
              <div className="character-bio"><RichText text={selectedCharacter.description} fallback="No biography is available for this character yet."/></div>
            </section>
            {selectedCharacter.siteUrl && <a className="secondary-btn character-source-link" href={selectedCharacter.siteUrl} target="_blank" rel="noreferrer">View full AniList profile <ExternalLink size={14}/></a>}
          </section>
        </div>}
      </section>}

      {activeTab === 'details' && <section className="entry-panel details-panel">
        <div className="entry-section-heading"><span className="eyebrow">ENTRY INFORMATION</span><h2>Details</h2></div>
        <div className="entry-details-grid">
          <div><span>Type</span><strong>{anime.format || 'Not listed'}</strong></div>
          <div><span>Status</span><strong>{statusLabel || 'Not listed'}</strong></div>
          <div><span>Release</span><strong>{releaseDate}</strong></div>
          <div><span>Author / creator</span><strong>{authors.length?authors.join(', '):pending||'Not listed by AniList'}</strong></div>
          <div><span>Artist</span><strong>{artists.length?artists.join(', '):pending||'Not listed by AniList'}</strong></div>
          <div><span>Country</span><strong>{countryName(anime.countryOfOrigin) || 'Not listed'}</strong></div>
          <div className="detail-wide"><span>Alternative titles</span><strong>{[anime.title.english,anime.title.romaji,anime.title.native,...(anime.synonyms||[])].filter((value,index,array)=>value && array.indexOf(value)===index).join(' · ') || 'Not listed'}</strong></div>
          <div><span>Source material</span><strong>{sourceName}</strong></div>
          <div><span>Studio</span><strong>{anime.studios?.nodes?.map(studio=>studio.name).join(', ') || 'Not listed'}</strong></div>
        </div>
        <div className="entry-source-links"><h3><Globe size={17}/> Source links</h3><div>{anime.siteUrl && <a href={anime.siteUrl} target="_blank" rel="noreferrer">AniList entry <ExternalLink size={13}/></a>}{sourceLinks.map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} <ExternalLink size={13}/></a>)}{loading&&!sourceLinks.length&&<span className="fine-print">Loading links…</span>}</div></div>
      </section>}

      {activeTab === 'comments' && <div className="entry-comments-panel"><AnimeComments animeId={anime.id} animeTitle={titleOf(anime)} user={user}/></div>}

      {showPlayer && <div className="player-panel"><div className="section-head"><div><h2>Watch panel</h2><p>Use a video URL you are authorized to access.</p></div><button className="icon-btn" onClick={()=>setShowPlayer(false)} aria-label="Close player"><X/></button></div><div className="source-input"><input value={source} onChange={e=>setSource(e.target.value)} placeholder="Paste an authorized HTTPS video URL"/><button className="primary-btn" onClick={()=>{if(source.startsWith('https://')) window.open(source,'_blank','noopener,noreferrer');}}>Open source</button></div><p className="fine-print">RykoCollection does not host episodes or provide unauthorized streams. Playback and advertising behavior on external providers is controlled by those providers.</p></div>}
    </div>
  </main>;
}

/** Same markup as before; only adds the decorative ambient glow behind it. */
function TrailerFrame({ trailerId, title }: { trailerId: string; title: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  useAmbientGlow(frameRef, true, { frames: youtubeAmbientFrames(trailerId) });
  return <div ref={frameRef} className="entry-trailer-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${trailerId}?rel=0`} title={title} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="origin"/></div>;
}

type LibraryStatus = 'Watching' | 'Plan to Watch' | 'Completed' | 'Waiting';
type LibraryTab = 'anime' | 'manga' | 'video';
const LIBRARY_GROUPS: LibraryStatus[] = ['Watching', 'Plan to Watch', 'Completed', 'Waiting'];
const isReadingEntry = (item: Anime) => item.id.startsWith('anilist-m-') || /manga|manhwa|manhua|novel|one_shot|comic|webtoon/i.test(item.format || '');
const libraryStatusLabel = (status: LibraryStatus, reading: boolean) => reading ? (status === 'Watching' ? 'Reading' : status === 'Plan to Watch' ? 'Plan to Read' : status) : status;

function LibrarySearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="large-search library-search"><Search size={18}/><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off"/>{value && <button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={15}/></button>}</label>;
}
function LibrarySelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="genre-select"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}

function WatchlistPage() {
  const { saved, toggle, statuses, setLibraryStatus, progress, setProgress, savedVideos, toggleVideo } = useLibrary();
  const [tab, setTab] = useState<LibraryTab>(() => { const v = localStorage.getItem('rykoc-library-tab'); return v === 'manga' || v === 'video' ? v : 'anime'; });
  useEffect(() => { localStorage.setItem('rykoc-library-tab', tab); }, [tab]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const tabActive = useTabActive();
  useEffect(() => { if (!tabActive) setPlayingId(null); }, [tabActive]);
  useEffect(() => { setPlayingId(null); }, [tab]);

  // Separate filters per sub-tab, so switching keeps what you set on each one.
  const [anime, setAnimeF] = useState({ q: '', status: '', genre: '', sort: 'recent' });
  const [manga, setMangaF] = useState({ q: '', status: '', type: '', genre: '', sort: 'recent' });
  const [video, setVideoF] = useState({ q: '', type: '', category: '', sort: 'recent' });

  const statusOf = (item: Anime): LibraryStatus => statuses[item.id] || 'Plan to Watch';
  const totalOf = (item: Anime) => isReadingEntry(item) ? (item.chapters || 0) : (item.episodes || 0);
  const animeItems = saved.filter(item => !isReadingEntry(item));
  const mangaItems = saved.filter(isReadingEntry);
  const bump = (item: Anime, delta: number) => {
    const total = totalOf(item);
    const next = Math.max(0, (progress[item.id] || 0) + delta);
    setProgress(item.id, next, total);
    if (delta > 0 && statusOf(item) === 'Plan to Watch') setLibraryStatus(item.id, 'Watching');
    if (total && next >= total && statusOf(item) !== 'Completed') { setLibraryStatus(item.id, 'Completed'); showToast(`${titleOf(item)} marked as completed`); }
  };

  const filterTitles = (items: Anime[], f: { q: string; status: string; genre: string; sort: string; type?: string }) => {
    const q = f.q.trim().toLowerCase();
    const list = items.filter(item =>
      (!q || [item.title.english, item.title.romaji, item.title.native, ...(item.synonyms || [])].filter(Boolean).join(' ').toLowerCase().includes(q)) &&
      (!f.status || statusOf(item) === f.status) &&
      (!f.genre || (item.genres || []).includes(f.genre)) &&
      (!f.type || (item.format || '') === f.type));
    const order = new Map(items.map((item, index) => [item.id, index]));
    const sorters: Record<string, (a: Anime, b: Anime) => number> = {
      recent: (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      oldest: (a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0),
      title: (a, b) => titleOf(a).localeCompare(titleOf(b)),
      score: (a, b) => (b.averageScore || 0) - (a.averageScore || 0),
      progress: (a, b) => (progress[b.id] || 0) / Math.max(1, totalOf(b) || progress[b.id] || 1) - (progress[a.id] || 0) / Math.max(1, totalOf(a) || progress[a.id] || 1),
      year: (a, b) => (b.seasonYear || 0) - (a.seasonYear || 0)
    };
    return [...list].sort(sorters[f.sort] || sorters.recent);
  };
  const genresOf = (items: Anime[]) => [...new Set(items.flatMap(item => item.genres || []))].sort();
  const sortOptions: Array<[string, string]> = [['recent', 'Recently added'], ['oldest', 'Oldest added'], ['title', 'Title A–Z'], ['score', 'Top score'], ['progress', 'Most progress'], ['year', 'Newest release']];

  const titleCard = (item: Anime) => {
    const reading = isReadingEntry(item); const total = totalOf(item); const done = progress[item.id] || 0; const unit = reading ? 'Ch' : 'Ep';
    return <article className="anime-card" key={item.id}><Link to={`/anime/${item.id}`} className="poster-wrap"><img src={imageOf(item)} alt={titleOf(item)} loading="lazy"/><span className="poster-format">{item.format || (reading ? 'MANGA' : 'ANIME')}</span>{total ? <span className="poster-progress" aria-hidden="true"><span style={{width:`${Math.min(100, done / total * 100)}%`}}/></span> : null}</Link><div className="card-meta"><Link to={`/anime/${item.id}`} className="card-title">{titleOf(item)}</Link>
      <div className="progress-stepper"><button type="button" onClick={()=>bump(item,-1)} disabled={!done} aria-label={`Decrease progress for ${titleOf(item)}`}><Minus size={14}/></button><span>{unit} {done}{total ? ` / ${total}` : ''}</span><button type="button" onClick={()=>bump(item,1)} disabled={!!total && done >= total} aria-label={`Increase progress for ${titleOf(item)}`}><Plus size={14}/></button></div>
      <select aria-label={`Status for ${titleOf(item)}`} value={statusOf(item)} onChange={event=>setLibraryStatus(item.id,event.target.value as LibraryStatus)}>{LIBRARY_GROUPS.map(status=><option key={status} value={status}>{libraryStatusLabel(status, reading)}</option>)}</select><button className="library-remove" onClick={()=>toggle(item)}>Remove from library</button></div></article>;
  };

  const titleTab = (kind: 'anime' | 'manga') => {
    const reading = kind === 'manga';
    const items = reading ? mangaItems : animeItems;
    const f = reading ? manga : anime;
    const set = (patch: Partial<typeof manga>) => reading ? setMangaF(old => ({ ...old, ...patch })) : setAnimeF(old => ({ ...old, ...patch }));
    const list = filterTitles(items, f);
    const filtered = !!(f.q || f.status || f.genre || (reading && manga.type));
    const units = items.reduce((sum, item) => sum + (progress[item.id] || 0), 0);
    if (!items.length) return <div className="empty-state"><Bookmark size={28}/><h3>{reading ? 'No manga saved yet' : 'No anime saved yet'}</h3><p>{reading ? 'Save manga, manhwa or manhua from Browse and they will appear here.' : 'Save anime from Home or Browse and they will appear here.'}</p><Link className="primary-btn" to={reading ? '/search?format=Manga' : '/search?format=Anime'}>Discover {reading ? 'manga' : 'anime'}</Link></div>;
    const groups = f.status ? [f.status as LibraryStatus] : LIBRARY_GROUPS;
    return <>
      <div className="library-stats" aria-label="Statistics">{[['Saved', items.length], ...LIBRARY_GROUPS.map(g => [libraryStatusLabel(g, reading), items.filter(item => statusOf(item) === g).length]), [reading ? 'Chapters read' : 'Episodes watched', units]].map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="filter-bar browse-filters library-filters"><LibrarySearch value={f.q} onChange={q => set({ q })} placeholder={reading ? 'Search your manga' : 'Search your anime'}/>
        <div className="browse-filter-selects">
          <LibrarySelect label="Status" value={f.status} onChange={status => set({ status })} options={[['', 'All statuses'], ...LIBRARY_GROUPS.map(g => [g, libraryStatusLabel(g, reading)] as [string, string])]}/>
          {reading && <LibrarySelect label="Type" value={manga.type} onChange={type => set({ type })} options={[['', 'All types'], ...[...new Set(mangaItems.map(item => item.format || '').filter(Boolean))].sort().map(v => [v, v] as [string, string])]}/>}
          <LibrarySelect label="Genre" value={f.genre} onChange={genre => set({ genre })} options={[['', 'All genres'], ...genresOf(items).map(g => [g, g] as [string, string])]}/>
          <LibrarySelect label="Sort" value={f.sort} onChange={sort => set({ sort })} options={sortOptions}/>
        </div></div>
      {filtered && <div className="browse-results-head"><div className="results-caption">{list.length} of {items.length} titles</div><button type="button" className="secondary-btn surprise-btn" onClick={() => set({ q: '', status: '', genre: '', type: '' })}>Clear filters</button></div>}
      {!list.length ? <div className="empty-state"><Search size={26}/><h3>No matches</h3><p>Try another search or filter.</p></div> :
        groups.map(group => { const entries = list.filter(item => statusOf(item) === group); if (filtered && !entries.length) return null; return <section className="section library-group" key={group}><div className="section-head"><div><h2>{libraryStatusLabel(group, reading)}</h2><p>{entries.length} {entries.length===1?'title':'titles'}</p></div></div>{entries.length ? <div className="anime-grid">{entries.map(titleCard)}</div> : <p className="library-empty">No titles in this category yet.</p>}</section>; })}
    </>;
  };

  const videoTab = () => {
    if (!savedVideos.length) return <div className="empty-state"><Play size={28}/><h3>No saved videos yet</h3><p>Tap ••• on any video and choose Save to Watch later.</p><Link className="primary-btn" to="/video">Browse videos</Link></div>;
    const q = video.q.trim().toLowerCase();
    const kindOf = (v: RelatedVideo) => detectVideoFormat(v.videoUrl);
    const categories = [...new Set(savedVideos.map(v => v.titleFormat || '').filter(Boolean))].sort();
    let list = savedVideos.filter(v =>
      (!q || [v.videoTitle, v.creatorName, v.titleName].join(' ').toLowerCase().includes(q)) &&
      (!video.type || kindOf(v) === video.type) &&
      (!video.category || (v.titleFormat || '') === video.category));
    if (video.sort === 'oldest') list = [...list].reverse();
    if (video.sort === 'title') list = [...list].sort((a, b) => (a.videoTitle || a.titleName || '').localeCompare(b.videoTitle || b.titleName || ''));
    if (video.sort === 'creator') list = [...list].sort((a, b) => (a.creatorName || '').localeCompare(b.creatorName || ''));
    const filtered = !!(video.q || video.type || video.category);
    const shorts = list.filter(v => kindOf(v) === 'short'); const regular = list.filter(v => kindOf(v) !== 'short');
    const card = (v: RelatedVideo, short: boolean) => <LazyVideoCard key={v.id} video={v} short={short} playing={playingId===v.id} onPlay={()=>setPlayingId(current=>current===v.id?null:v.id)} saved onToggleSave={()=>toggleVideo(v)}/>;
    return <>
      <div className="library-stats library-stats-3">{[['Saved', savedVideos.length], ['Videos', savedVideos.filter(v => kindOf(v) !== 'short').length], ['Shorts', savedVideos.filter(v => kindOf(v) === 'short').length]].map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="filter-bar browse-filters library-filters"><LibrarySearch value={video.q} onChange={q => setVideoF(old => ({ ...old, q }))} placeholder="Search saved videos, creators or titles"/>
        <div className="browse-filter-selects">
          <LibrarySelect label="Type" value={video.type} onChange={type => setVideoF(old => ({ ...old, type }))} options={[['', 'All'], ['video', 'Videos'], ['short', 'Shorts']]}/>
          <LibrarySelect label="Category" value={video.category} onChange={category => setVideoF(old => ({ ...old, category }))} options={[['', 'All categories'], ...categories.map(c => [c, c] as [string, string])]}/>
          <LibrarySelect label="Sort" value={video.sort} onChange={sort => setVideoF(old => ({ ...old, sort }))} options={[['recent', 'Recently saved'], ['oldest', 'Oldest saved'], ['title', 'Title A–Z'], ['creator', 'Creator A–Z']]}/>
        </div></div>
      {filtered && <div className="browse-results-head"><div className="results-caption">{list.length} of {savedVideos.length} videos</div><button type="button" className="secondary-btn surprise-btn" onClick={() => setVideoF(old => ({ ...old, q: '', type: '', category: '' }))}>Clear filters</button></div>}
      {!list.length ? <div className="empty-state"><Search size={26}/><h3>No matches</h3><p>Try another search or filter.</p></div> : <>
        {regular.length > 0 && <section className="section library-group library-videos"><div className="section-head"><div><h2>Videos</h2><p>{regular.length} saved</p></div></div><div className="yt-video-feed">{regular.map(v => card(v, false))}</div></section>}
        {shorts.length > 0 && <section className="section library-group library-videos"><div className="section-head"><div><h2>Shorts</h2><p>{shorts.length} saved</p></div></div><div className="yt-shorts-grid">{shorts.map(v => card(v, true))}</div></section>}
      </>}
    </>;
  };

  const tabs: Array<{ id: LibraryTab; label: string; count: number; icon: ReactNode }> = [
    { id: 'anime', label: 'Anime', count: animeItems.length, icon: <Tv size={16}/> },
    { id: 'manga', label: 'Manga', count: mangaItems.length, icon: <FileText size={16}/> },
    { id: 'video', label: 'Video', count: savedVideos.length, icon: <Play size={16}/> }
  ];
  return <main className="content-page library-page"><div className="page-heading"><span className="eyebrow">YOUR PERSONAL COLLECTION</span><h1>Your <em>Library.</em></h1><p>Anime, manga and saved videos in one place.</p></div>
    <div className="library-tabs" role="tablist" aria-label="Library sections">{tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab===item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.icon}<span>{item.label}</span><small>{item.count}</small></button>)}</div>
    <div role="tabpanel">{tab === 'video' ? videoTab() : titleTab(tab)}</div>
  </main>;
}
function videoEmbedUrl(video: RelatedVideo) {
  try {
    const url = new URL(video.videoUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);

    // Detect the provider from the actual URL as well as the saved platform value.
    // This prevents old or incorrectly tagged records from producing a broken embed.
    if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      let id = host === 'youtu.be' ? parts[0] : url.searchParams.get('v');
      if (!id && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
      if (!id && parts.length === 1) id = parts[0];
      if (!id || !/^[a-zA-Z0-9_-]{6,}$/.test(id)) return '';
      // Match the known-working AniList trailer player exactly. Avoid enablejsapi/origin
      // parameters here: this app only needs plain iframe playback, not the JS player API.
      return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
    }

    if (host === 'dai.ly' || host.endsWith('dailymotion.com')) {
      const id = parts[0] === 'video' ? parts[1]?.split('_')[0] : parts[0]?.split('_')[0];
      return id && /^[a-zA-Z0-9]+$/.test(id) ? `https://www.dailymotion.com/embed/video/${id}` : '';
    }

    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') {
      const kind = ['p', 'reel', 'reels', 'tv'].includes(parts[0]) ? parts[0] : '';
      const id = kind ? parts[1] : '';
      return kind && id ? `https://www.instagram.com/${kind}/${id}/embed/` : '';
    }
  } catch { return ''; }
  return '';
}

function youtubeIdOf(video: RelatedVideo) {
  try {
    const url = new URL(video.videoUrl);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (host === 'youtu.be') id = parts[0] || null;
    else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) id = url.searchParams.get('v') || (['embed','shorts','live','v'].includes(parts[0]) ? parts[1] : null);
    return id && /^[a-zA-Z0-9_-]{6,}$/.test(id) ? id : null;
  } catch { return null; }
}

function videoThumbnail(video: RelatedVideo) {
  try {
    const url = new URL(video.videoUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let id = '';
    if (host === 'youtu.be') id = parts[0] || '';
    else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      id = url.searchParams.get('v') || (['embed','shorts','live','v'].includes(parts[0]) ? parts[1] : '') || '';
    }
    if (id && /^[a-zA-Z0-9_-]{6,}$/.test(id)) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } catch { /* Use the saved title cover for unsupported or malformed URLs. */ }
  return video.titleCover || '';
}
function detectVideoFormat(url:string) {
  try {
    const u=new URL(String(url||'').trim()),host=u.hostname.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
    const parts=u.pathname.split('/').filter(Boolean);
    if((host==='youtube.com'||host==='youtube-nocookie.com')&&parts[0]==='shorts')return 'short';
    if(host==='instagram.com'&&['reel','reels'].includes(parts[0]))return 'short';
    if(host==='tiktok.com'&&parts.includes('video'))return 'short';
    return 'video';
  } catch { return 'video'; }
}
function LazyVideoCard({ video, short, playing, onPlay, saved = false, onToggleSave }: { video: RelatedVideo; short: boolean; playing: boolean; onPlay: () => void; saved?: boolean; onToggleSave?: () => void }) {
  const cardRef = useRef<HTMLElementTagNameMap['article'] | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) { setNearViewport(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const embed = videoEmbedUrl(video);
  const thumbnail = videoThumbnail(video);
  const thumbRef = useRef<HTMLDivElement>(null);
  const ambientFrames = useMemo(() => { const yt = youtubeAmbientFrames(youtubeIdOf(video)); return yt.length ? yt : [thumbnail].filter(Boolean); }, [video.videoUrl, thumbnail]);
  useAmbientGlow(thumbRef, nearViewport && playing && !!embed, { frames: ambientFrames, assumePlaying: true });
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const tabActive = useTabActive();
  useEffect(() => { if (!tabActive) setMenuOpen(false); }, [tabActive]);
  return <article ref={cardRef} className={`yt-video-card ${short?'yt-short-card':'yt-standard-card'}`}>
    {!nearViewport ? <>
      <div className="yt-thumbnail"><div className="yt-skeleton-thumb"/></div>
      <div className="yt-video-info"><span className="yt-skeleton-avatar"/><div className="yt-video-text"><span className="yt-skeleton-line"/><span className="yt-skeleton-line"/></div></div>
    </> : <>
      <div ref={thumbRef} className="yt-thumbnail">
        {playing&&embed?<iframe key={video.id} src={embed} title={video.videoTitle||video.titleName||'Ryko video'} loading="eager" allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="origin"/>:
        <button className="yt-thumbnail-button" onClick={onPlay} aria-label={playing?'Close player':'Play video'}>
          {thumbnail?<img src={thumbnail} alt={video.videoTitle||video.titleName||'Video thumbnail'} loading="lazy" decoding="async" fetchPriority="low" onError={e=>{e.currentTarget.onerror=null;e.currentTarget.src=video.titleCover||'/placeholder-poster.svg';}}/>:<span className="yt-thumbnail-fallback"/>}
          <span className="yt-play-overlay"><Play size={short?24:30} fill="currentColor"/></span>
          {short&&<span className="yt-shorts-label">SHORTS</span>}
        </button>}
        {playing&&!embed&&<div className="yt-unavailable">This video cannot play in an embedded player. <a href={video.videoUrl} target="_blank" rel="noopener noreferrer">Open original <ExternalLink size={12}/></a></div>}
      </div>
      <div className="yt-video-info">
        {video.creatorAvatarUrl?<img className="yt-channel-avatar" src={video.creatorAvatarUrl} alt="" loading="lazy" decoding="async"/>:<span className="yt-channel-avatar yt-avatar-fallback">{(video.creatorName||video.titleName||'R').slice(0,1).toUpperCase()}</span>}
        <div className="yt-video-text"><h3>{(video.videoTitle||video.titleName||'Related video').length>50?(video.videoTitle||video.titleName||'Related video').slice(0,47).trimEnd()+'…':video.videoTitle||video.titleName||'Related video'}</h3><p>{video.creatorName||'RykoCollection'}</p><p>{video.titleName||'Ryko video catalogue'}</p>{video.actionUrl&&<a className="yt-related" href={video.actionUrl} target="_blank" rel="noopener noreferrer">{video.actionType==='read'?'View title':'Related link'} <ExternalLink size={11}/></a>}</div>
        <button ref={moreRef} type="button" className="yt-more" onClick={()=>setMenuOpen(open=>!open)} aria-label="More options" aria-haspopup="dialog" aria-expanded={menuOpen}><span>•••</span></button>
        <VideoActionMenu video={video} anchor={moreRef.current} open={menuOpen} onClose={()=>setMenuOpen(false)} playing={playing} onPlay={onPlay} saved={saved} onToggleSave={onToggleSave}/>
      </div>
    </>}
  </article>;
}

function VideoPage() {
  const [videos,setVideos]=useState<RelatedVideo[]>([]);
  const [page,setPage]=useState(1);
  const [hasMore,setHasMore]=useState(true);
  const [playingId,setPlayingId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [error,setError]=useState('');
  const [term,setTerm]=useState('');
  const [format,setFormat]=useState<'all'|'video'|'short'>('all');
  const [category,setCategory]=useState('All');
  const tabActive=useTabActive();
  useEffect(()=>{if(!tabActive)setPlayingId(null);},[tabActive]);
  const {savedVideos,toggleVideo}=useLibrary();
  const savedVideoIds=useMemo(()=>new Set(savedVideos.map(video=>video.id)),[savedVideos]);

  // Patch titles/channels into cards as each background batch arrives (order never changes).
  const enrich=(list:RelatedVideo[],isActive:()=>boolean)=>{
    void enrichVideoMetadataProgressive(list,()=>{
      if(!isActive())return;
      setVideos(old=>applyCachedVideoMetadata(old));
    });
  };
  useEffect(()=>{
    let active=true;
    // Instant first paint from the last visit, then refresh in the background.
    const snapshot=readPersisted<RelatedVideo[]>('video-feed',12*60*60*1000);
    if(snapshot?.length){setVideos(applyCachedVideoMetadata(snapshot));setLoading(false);}
    getRelatedVideos(1).then(data=>{
      if(!active)return;
      // Show cards right away (with any titles cached on this device); fetch the rest progressively.
      setVideos(applyCachedVideoMetadata(data));
      setHasMore(data.length>0);
      setLoading(false);
      writePersisted('video-feed',data);
      enrich(data,()=>active);
    }).catch(e=>{
      if(active&&!snapshot?.length)setError(e instanceof Error?e.message:'Could not load videos.');
    }).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);

  const filtered=useMemo(()=>{
    const query=term.trim().toLowerCase();
    return videos.filter(video=>{
      const matchesText=!query||[video.videoTitle,video.creatorName,video.titleName].join(' ').toLowerCase().includes(query);
      const matchesCategory=category==='All'||(video.titleFormat||'').toLowerCase()===category.toLowerCase();
      return matchesText&&matchesCategory;
    });
  },[videos,term,category]);

  // Build a lightweight taste profile from the user's own saved titles and history.
  const {recommendedRegular,recommendedShorts}=useMemo(()=>{
    const saved=readStore<Anime[]>('kairo-watchlist',[]);
    const history=readStore<StoredProgress[]>('kairo-history',[]);
    const genres=new Set(saved.flatMap(item=>item.genres||[]).map(value=>value.toLowerCase()));
    const formats=new Set(saved.map(item=>(item.format||'').toLowerCase()));
    const titleSignals=[...saved.map(item=>titleOf(item)),...history.map(item=>item.title)]
      .map(value=>value.toLowerCase()).filter(Boolean);
    const score=(video:RelatedVideo)=>{
      const title=(video.titleName||video.videoTitle||'').toLowerCase();
      const genreScore=(video.genres||[]).reduce((sum,genre)=>sum+(genres.has(genre.toLowerCase())?5:0),0);
      const formatScore=formats.has((video.titleFormat||'').toLowerCase())?3:0;
      const titleScore=titleSignals.some(value=>title&&(title.includes(value)||value.includes(title)))?12:0;
      return genreScore+formatScore+titleScore;
    };
    const shuffle=(items:RelatedVideo[])=>{
      const result=items.map(video=>({video,score:score(video),random:stableRandom(video.id)}));
      result.sort((a,b)=>b.score-a.score||a.random-b.random);
      return result.map(item=>item.video);
    };
    return {
      recommendedRegular:shuffle(filtered.filter(video=>detectVideoFormat(video.videoUrl)==='video')),
      recommendedShorts:shuffle(filtered.filter(video=>detectVideoFormat(video.videoUrl)==='short'))
    };
  },[filtered]);

  const feedBlocks=useMemo(()=>{
    const blocks:{kind:'videos'|'shorts';items:RelatedVideo[]}[]=[];
    let videoIndex=0;
    let shortIndex=0;
    while(videoIndex<recommendedRegular.length){
      blocks.push({kind:'videos',items:recommendedRegular.slice(videoIndex,videoIndex+10)});
      videoIndex+=10;
      if(shortIndex<recommendedShorts.length){
        const batchSize=6+Math.floor(stableRandom('shorts-'+blocks.length)*5);
        const count=Math.min(batchSize,recommendedShorts.length-shortIndex);
        blocks.push({kind:'shorts',items:recommendedShorts.slice(shortIndex,shortIndex+count)});
        shortIndex+=count;
      }
    }
    if(!recommendedRegular.length&&recommendedShorts.length){
      blocks.push({kind:'shorts',items:recommendedShorts.slice(0,10)});
    }
    return blocks;
  },[recommendedRegular,recommendedShorts]);

  const loadMore=async()=>{
    if(loadingMore||!hasMore)return;
    setLoadingMore(true);
    setError('');
    try{
      const raw=await getRelatedVideos(page+1);
      const data=applyCachedVideoMetadata(raw);
      setVideos(old=>{const ids=new Set(old.map(video=>video.id));return [...old,...data.filter(video=>!ids.has(video.id))];});
      setPage(current=>current+1);
      setHasMore(data.length>0);
      enrich(data,()=>true);
    }catch(e){
      setError(e instanceof Error?e.message:'Could not load more videos.');
    }finally{
      setLoadingMore(false);
    }
  };

  const videoSentinel=useNearViewport(()=>{void loadMore();},!loading&&hasMore&&!loadingMore&&!error);

  const filterBar=<>
    <nav className="yt-filter-bar" aria-label="Video format">
      {([{id:'all',label:'All'},{id:'video',label:'Videos'},{id:'short',label:'Shorts'}] as const).map(item=><button key={item.id} className={format===item.id?'active':''} onClick={()=>setFormat(item.id)}>{item.label}</button>)}
    </nav>
    <nav className="yt-category-bar" aria-label="Filter by title category">
      {['All','Anime','Manga','Manhwa','Manhua','Movie','TV Series'].map(item=><button key={item} className={category===item?'active':''} onClick={()=>setCategory(item)}>{item}</button>)}
    </nav>
  </>;

  const searchBar=<header className="yt-topbar">
    <div className="yt-brand"><span className="yt-brand-mark"><Play size={17} fill="currentColor"/></span><strong>Ryko<span>Tube</span></strong><small>Collection</small></div>
    <label className="yt-search"><Search size={19}/><input value={term} onChange={event=>setTerm(event.target.value)} placeholder="Search videos, creators or titles" autoComplete="off"/>{term&&<button onClick={()=>setTerm('')} aria-label="Clear search"><X size={16}/></button>}</label>
  </header>;

  const empty=<div className="yt-empty"><Play size={28}/><h3>{term||category!=='All'?'No matching videos':'No videos yet'}</h3><p>Try changing your search or filters.</p><button className="secondary-btn" onClick={()=>{setTerm('');setCategory('All');setFormat('all');}}>Clear filters</button></div>;
  const videoCard=(video:RelatedVideo,short:boolean)=><LazyVideoCard key={video.id} video={video} short={short} playing={playingId===video.id} onPlay={()=>setPlayingId(current=>current===video.id?null:video.id)} saved={savedVideoIds.has(video.id)} onToggleSave={()=>toggleVideo(video)}/>;

  return <main className="video-page yt-page">
    {searchBar}
    {filterBar}
    {error&&<div className="notice">{error}</div>}
    {loading?<div className="yt-loading-grid" aria-label="Loading videos">{Array.from({length:4},(_,index)=><div className="yt-skeleton-card" key={index}><div className="yt-skeleton-thumb"/><div className="yt-skeleton-meta"><div className="yt-skeleton-avatar"/><div className="yt-skeleton-copy"><span className="yt-skeleton-line"/><span className="yt-skeleton-line"/></div></div></div>)}</div>
    :format==='all'?feedBlocks.length?feedBlocks.map((block,index)=><section className={block.kind==='shorts'?'yt-section yt-shorts-section':'yt-section'} key={block.kind+'-'+index}>
      <div className="yt-section-heading"><div><h2>{block.kind==='shorts'?<><span className="yt-shorts-symbol">▰</span> Shorts</>:'Recommended videos'}</h2><p>{block.kind==='shorts'?'A random mix of quick clips':'Community uploads and anime or manga trailers picked around your interests'}</p></div><span>{block.items.length} {block.kind}</span></div>
      <div className={block.kind==='shorts'?'yt-shorts-row':'yt-video-feed'}>{block.items.map(video=>videoCard(video,block.kind==='shorts'))}</div>
    </section>):empty
    :(()=>{const selected=format==='short'?recommendedShorts:recommendedRegular;return selected.length?<section className="yt-section">
      <div className="yt-section-heading"><div><h2>{format==='short'?'Shorts':'Videos'}</h2><p>{format==='short'?'Quick vertical clips':'Trailers, edits and community videos'}</p></div><span>{selected.length} results</span></div>
      <div className={format==='short'?'yt-shorts-grid':'yt-video-feed'}>{selected.map(video=>videoCard(video,format==='short'))}</div>
    </section>:empty;})()}
    {!loading&&hasMore&&<div className="load-more-wrap" ref={videoSentinel}><button className="secondary-btn load-more-btn" onClick={loadMore} disabled={loadingMore}>{loadingMore?'Loading…':'Load more'}</button></div>}
    <p className="yt-disclaimer">Playback availability depends on each original video provider and its embedding settings.</p>
  </main>;
}
function BottomNavigation() {
  const location = useLocation();
  const links = [
    { to: '/', label: 'Home', icon: <HomeIcon size={19}/> },
    { to: '/search', label: 'Browse', icon: <Compass size={19}/> },
    { to: '/video', label: 'Video', icon: <Play size={19}/> },
    { to: '/watchlist', label: 'Library', icon: <Bookmark size={19}/> },
    { to: '/account', label: 'Account', icon: <UserRound size={19}/> }
  ];
  return <nav className="bottom-navigation" aria-label="Main navigation">{links.map(item => {
    const active = item.to === '/' ? location.pathname === '/' : location.pathname === item.to;
    return <Link key={item.to} to={item.to} onClick={event => { if (active) { event.preventDefault(); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } }} className={active?'bottom-nav-item active':'bottom-nav-item'} aria-current={active?'page':undefined}>{item.icon}<span>{item.label}</span></Link>;
  })}</nav>;
}

function AccountPage({ user }: { user: User | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'signin'|'signup'>('signin');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName.trim() || email.split('@')[0] } } });
        if (error) throw error;
        setMessage('Account created. Check your email if confirmation is enabled.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage('Signed in successfully.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete sign in.'); }
    finally { setBusy(false); }
  };
  return <main className="content-page account-page"><div className="page-heading"><span className="eyebrow">YOUR RYKOCOLLECTION PROFILE</span><h1>Your <em>Account.</em></h1><p>Sign in to join discussions and keep your profile connected.</p></div>
    {user ? <section className="account-card"><div className="account-avatar">{String(user.user_metadata?.display_name || user.email || 'R').slice(0,1).toUpperCase()}</div><div><span className="eyebrow">SIGNED IN</span><h2>{String(user.user_metadata?.display_name || user.email?.split('@')[0] || 'Anime fan')}</h2><p>{user.email}</p><button className="secondary-btn" onClick={()=>void supabase.auth.signOut()}>Sign out</button></div></section> :
    <form className="account-card account-form" onSubmit={submit}><div className="account-avatar"><UserRound/></div><h2>{mode==='signin'?'Welcome back':'Create your account'}</h2><p>{mode==='signin'?'Sign in to your RykoCollection account.':'Create a profile to participate in community features.'}</p>
      {mode==='signup' && <input value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="Display name" autoComplete="nickname"/>}
      <input type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="Email address" autoComplete="email" required/>
      <input type="password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Password" autoComplete={mode==='signin'?'current-password':'new-password'} minLength={6} required/>
      <button className="primary-btn" disabled={busy}>{busy?'Please wait…':mode==='signin'?'Sign in':'Create account'}</button>
      <button type="button" className="account-switch" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setMessage('');}}>{mode==='signin'?'New here? Create an account':'Already have an account? Sign in'}</button>
      {message && <p className="account-message">{message}</p>}
    </form>}
    <AppSettings/>
  </main>;
}

function AppSettings() {
  const [ambient, setAmbient] = useState(() => isAmbientEnabled());
  const [cacheSize, setCacheSize] = useState(0);
  const measure = () => {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i) || ''; if (key.startsWith('rykoc-cache:')) bytes += (localStorage.getItem(key) || '').length * 2; }
    setCacheSize(bytes);
  };
  useEffect(measure, []);
  const toggleAmbient = () => { const next = !ambient; setAmbient(next); setAmbientEnabled(next); showToast(next ? 'Ambient mode on' : 'Ambient mode off'); };
  const clearCache = () => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i) || ''; if (key.startsWith('rykoc-cache:')) keys.push(key); }
    keys.forEach(key => localStorage.removeItem(key));
    measure();
    showToast('Cached catalogue cleared. Your library is kept.');
  };
  return <section className="settings-card" aria-labelledby="settings-title">
    <h2 id="settings-title"><Settings size={18}/> App settings</h2>
    <div className="settings-row"><div><strong>Ambient mode</strong><p>Soft light from the video glows behind the player.</p></div><button className={ambient?'toggle active':'toggle'} onClick={toggleAmbient} aria-label="Toggle ambient mode" aria-pressed={ambient}><span/></button></div>
    <div className="settings-row"><div><strong>Cached catalogue</strong><p>{(cacheSize / 1024).toFixed(0)} KB saved for faster loading. Library, progress and Watch later are not affected.</p></div><button className="secondary-btn" onClick={clearCache}><Trash2 size={15}/> Clear</button></div>
  </section>;
}

function PrivacyPage() {
  const [protection, setProtection] = useState(()=>readStore('kairo-privacy', true));
  useEffect(()=>localStorage.setItem('kairo-privacy', JSON.stringify(protection)),[protection]);
  return <main className="content-page privacy-page"><div className="page-heading"><span className="eyebrow">YOUR DATA, YOUR CHOICE</span><h1>Privacy <em>center.</em></h1><p>Simple controls and clear information about what this app can protect.</p></div>
    <div className="privacy-card"><div className="privacy-icon"><ShieldCheck/></div><div className="privacy-copy"><h2>Privacy-friendly mode</h2><p>Controls optional local preferences and keeps this app free of injected ad scripts and third-party analytics.</p></div><button className={protection?'toggle active':'toggle'} onClick={()=>setProtection(!protection)} aria-label="Toggle privacy mode"><span/></button></div>
    <div className="privacy-grid"><div className="privacy-info"><h3><ShieldCheck size={17}/> First-party protection</h3><p>No advertising SDKs or analytics trackers are bundled by this application. External links open with safe browser isolation attributes.</p><span className="status-good">Enabled by design</span></div><div className="privacy-info"><h3><ExternalLink size={17}/> External video providers</h3><p>This is a regular website, not a network-level ad blocker. It cannot filter requests inside cross-origin video iframes or control ads served by an external player.</p><span className="status-neutral">Provider controlled</span></div><div className="privacy-info"><h3><Bookmark size={17}/> Local data</h3><p>Your watchlist and recently viewed titles are stored in this browser's local storage. They are not synced to a server.</p><span className="status-good">Stored on this device</span></div><div className="privacy-info"><h3><ShieldCheck size={17}/> Protection limits</h3><p>For stronger network-wide filtering, use a reputable browser content blocker or device-level DNS filtering. Do not disable provider security or access controls.</p><span className="status-neutral">Browser limitation</span></div></div>
    <p className="fine-print">AniList is used for public anime metadata. Requests are sent directly from your browser to AniList's public GraphQL API. Privacy mode does not claim to block all advertisements on third-party websites.</p>
  </main>;
}

const TAB_PATHS = ['/', '/search', '/video', '/watchlist', '/account'] as const;
type TabPath = typeof TAB_PATHS[number];
const isTabPath = (path: string): path is TabPath => (TAB_PATHS as readonly string[]).includes(path);

/**
 * Bottom-navigation tabs stay mounted after their first visit and are only hidden
 * when another page is shown. Each tab keeps its own data, loaded pages, filters and
 * open state, and each one is rendered with the last location it saw, so a hidden
 * tab never reacts to another tab's URL. Other routes (detail, admin, …) render normally.
 */
function TabbedRoutes({ user }: { user: User | null }) {
  const location = useLocation();
  const activeTab = isTabPath(location.pathname) ? location.pathname : null;
  const tabLocations = useRef<Partial<Record<TabPath, Location>>>({});
  if (activeTab) tabLocations.current[activeTab] = location;
  const tabElement = (path: TabPath): ReactNode => path === '/' ? <Home/> : path === '/search' ? <SearchPage/> : path === '/video' ? <VideoPage/> : path === '/watchlist' ? <WatchlistPage/> : <AccountPage user={user}/>;
  return <>
    <ScrollMemory scrollKey={activeTab ?? location.key}/>
    {TAB_PATHS.filter(path => tabLocations.current[path]).map(path => <div key={path} className="tab-keepalive" style={{display: path === activeTab ? 'contents' : 'none'}}>
      <TabActiveContext.Provider value={path === activeTab}>
        <Routes location={tabLocations.current[path]}><Route path={path} element={tabElement(path)}/></Routes>
      </TabActiveContext.Provider>
    </div>)}
    {!activeTab && <Routes><Route path="/anime/:id" element={<DetailPage user={user}/>}/><Route path="/privacy" element={<PrivacyPage/>}/><Route path="/extensions" element={<Navigate to="/account" replace/>}/><Route path="/admin" element={<AdminWorkspace/>}/><Route path="*" element={<main className="content-page empty-state"><h1>Page not found</h1><Link to="/">Return home</Link></main>}/></Routes>}
  </>;
}

/**
 * The window has a single scroll position shared by every page. Remember it per tab
 * (and per history entry for other pages) and restore it instantly on switch, so one
 * tab's scrolling never moves another and returning to a tab lands where you left it.
 */
function ScrollMemory({ scrollKey }: { scrollKey: string }) {
  const positions = useRef(new Map<string, number>());
  const currentKey = useRef(scrollKey);
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    // Saved synchronously: reading scrollY inside a scroll event is cheap, and it must be
    // stored before the next tab switch (after a switch the old value may already be clamped).
    const save = () => { positions.current.set(currentKey.current, window.scrollY); };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);
  useLayoutEffect(() => {
    if (currentKey.current === scrollKey) return;
    currentKey.current = scrollKey;
    // 'instant' bypasses the global `scroll-behavior: smooth`, so switching never animates.
    window.scrollTo({ top: positions.current.get(scrollKey) ?? 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [scrollKey]);
  return null;
}

export default function App() {
  useAppBackNavigation();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUser(data.session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    if (!user) { setIsAdmin(false); return; }
    // Keep the admin entry point available for the verified owner account even if
    // the membership lookup is temporarily delayed in an embedded Android WebView.
    // This is only a UI fallback; Supabase RLS remains the authority for all data access.
    const VERIFIED_ADMIN_USER_IDS = ['4da14151-419b-4872-8e5b-6ec38185cdbf'];
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!active) return;
        setIsAdmin(!!data || VERIFIED_ADMIN_USER_IDS.includes(user.id));
        if (error) console.warn('Admin membership lookup failed; using verified UI fallback.', error.message);
      } catch (error) {
        if (active) setIsAdmin(VERIFIED_ADMIN_USER_IDS.includes(user.id));
        console.warn('Admin membership lookup failed.', error);
      }
    })();
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    // The manga extensions hub was removed; drop its leftover local data once.
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('rykoccllection-web-extension:') || key.startsWith('rykoccllection-extension-repositories') || key.startsWith('rykoccllection-installed-extensions')) localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    void flushPendingReports();
    const retry = () => { void flushPendingReports(); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [user]);
  const signOut = () => { void supabase.auth.signOut(); };
  return <><OfflineBanner/><Header user={user} isAdmin={isAdmin} onSignOut={signOut}/><TabbedRoutes user={user}/><BottomNavigation/><ToastHost/><footer className="footer"><Link to="/" className="brand"><img className="brand-mark brand-logo" src="/logo-192.png" alt="" width="31" height="31" loading="lazy"/><span>RYKOCOLLECTION</span></Link><p>Discover stories. Find your next world.</p><span>Shared Ryko catalogue · Independent fan discovery project</span></footer></>;
}
