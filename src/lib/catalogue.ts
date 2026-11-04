import { supabase } from './supabase';
import { getMediaCharacters, getVideoCatalogue as getAniListAnimeVideos, getMangaVideoCatalogue, getTrendingManga as fetchTrendingManga, getPopularManga as fetchPopularManga, searchMedia, getAniListMediaById, getTrending as fetchAniListTrending, getPopular as fetchAniListPopular } from './anilist';

export type AnimeCharacter = {
  id: number;
  name: { full?: string; native?: string; alternative?: string[] };
  image?: { large?: string; medium?: string };
  description?: string;
  gender?: string;
  age?: string;
  dateOfBirth?: { year?: number; month?: number; day?: number };
  siteUrl?: string;
  favourites?: number;
  role?: string;
};
export type AnimeStaff = { role: string; node: { name: { full?: string } } };
export type AnimeExternalLink = { url: string; site: string; type?: string };
export type RelatedVideo = { id: string; titleId: string; videoUrl: string; platform: 'youtube' | 'instagram' | 'dailymotion'; videoTitle: string; creatorName: string; creatorAvatarUrl: string; actionType: 'read' | 'watch'; actionUrl: string; sortOrder: number; createdAt: string; titleName?: string; titleCover?: string; titleFormat?: string; releaseYear?: number; genres?: string[] };
export type Anime = {
  id: string;
  anilistId?: number;
  title: { romaji?: string; english?: string; native?: string };
  description?: string;
  coverImage: { extraLarge?: string; large?: string; color?: string };
  bannerImage?: string;
  averageScore?: number;
  episodes?: number;
  status?: string;
  seasonYear?: number;
  format?: string;
  genres?: string[];
  studios?: { nodes: { name: string }[] };
  duration?: number;
  siteUrl?: string;
  nextAiringEpisode?: { episode: number; airingAt: number };
  trailer?: { id: string; site: string };
  trailerUrl?: string;
  relatedVideos?: RelatedVideo[];
  countryOfOrigin?: string;
  source?: string;
  synonyms?: string[];
  startDate?: { year?: number; month?: number; day?: number };
  staff?: { edges: AnimeStaff[] };
  externalLinks?: AnimeExternalLink[];
  characters?: { pageInfo: { currentPage: number; hasNextPage: boolean }; edges: { role: string; node: AnimeCharacter }[] };
};
type TitleRow = {
  id: string; name: string; alternative_names?: string[]; media_type?: string; synopsis?: string;
  cover_url?: string; banner_url?: string; genres?: string[]; themes?: string[]; status?: string;
  release_year?: number; season?: string; rating?: number; popularity?: number; chapters?: string;
  episodes?: string; author?: string; artist?: string; studio?: string; country?: string;
  source_url?: string; anilist_id?: number; trailer_url?: string; is_trending?: boolean; is_featured?: boolean;
};
type CharacterRow = { id: string; name: string; role?: string; description?: string; image_url?: string };
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 90_000;
const hashId = (value: string) => Array.from(value).reduce((h, c) => ((h * 31 + c.charCodeAt(0)) >>> 0), 7);
const youtubeId = (url = '') => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || '';
    }
  } catch { /* invalid or non-YouTube URL */ }
  return '';
};

type RelatedVideoRow = {
  id: string; title_id: string | null; legacy_title_id?: string | null; video_url: string; platform: 'youtube' | 'instagram' | 'dailymotion' | 'tiktok';
  video_title?: string; creator_name?: string; creator_avatar_url?: string; action_type?: 'read' | 'watch';
  action_url?: string; sort_order?: number; created_at: string;
};
const mapRelatedVideo = (row: RelatedVideoRow): RelatedVideo => ({
  id: row.id, titleId: row.title_id || row.legacy_title_id || '', videoUrl: row.video_url, platform: row.platform as RelatedVideo['platform'],
  videoTitle: row.video_title || '', creatorName: row.creator_name || '',
  creatorAvatarUrl: row.creator_avatar_url || '', actionType: row.action_type || 'watch',
  actionUrl: row.action_url || row.video_url, sortOrder: row.sort_order || 0, createdAt: row.created_at
});
export async function getRelatedVideos(page = 1, titleId?: string): Promise<RelatedVideo[]> {
  return cached(`related-videos:${page}:${titleId || 'all'}`, async () => {
    const from = (page - 1) * 40;
    let request = supabase.from('related_videos').select('id,title_id,legacy_title_id,video_url,platform,video_title,creator_name,creator_avatar_url,action_type,action_url,sort_order,created_at').order('sort_order', { ascending: true }).order('created_at', { ascending: false }).range(from, from + 39);
    if (titleId) request = request.or(`title_id.eq.${titleId},legacy_title_id.eq.${titleId}`);
    const { data, error } = await request;
    throwIf(error);
    const videos = ((data || []) as RelatedVideoRow[]).map(mapRelatedVideo);
    const titleIds = [...new Set(videos.map(video => video.titleId).filter(Boolean))];
    if (titleIds.length) {
      const { data: titles, error: titleError } = await supabase.from('titles').select('id,name,cover_url,media_type,release_year,genres').in('id', titleIds);
      throwIf(titleError);
      const byId = new Map((titles || []).map((title: any) => [title.id, title]));
      videos.forEach(video => {
        const title: any = byId.get(video.titleId);
        if (title) {
          video.titleName = title.name; video.titleCover = title.cover_url;
          video.titleFormat = title.media_type; video.releaseYear = title.release_year;
          video.genres = title.genres || [];
        }
      });
    }
    return videos;
  });
}

export async function getAniListTrailerVideos(page = 1): Promise<RelatedVideo[]> {
  return cached(`anilist-trailer-videos:${page}`, async () => {
    const [animeResult, mangaResult] = await Promise.allSettled([
      getAniListAnimeVideos(page), getMangaVideoCatalogue(page)
    ]);
    const anime = animeResult.status === 'fulfilled' ? animeResult.value : [];
    const manga = mangaResult.status === 'fulfilled' ? mangaResult.value : [];
    const knownUrls = new Set<string>();
    return [...anime, ...manga].flatMap(item => {
      const trailerId = item.trailer?.site?.toLowerCase() === 'youtube' && /^[a-zA-Z0-9_-]{6,}$/.test(item.trailer.id) ? item.trailer.id : '';
      if (!trailerId) return [];
      const videoUrl = `https://www.youtube.com/watch?v=${trailerId}`;
      if (knownUrls.has(videoUrl)) return [];
      knownUrls.add(videoUrl);
      const mediaFormat = item.format || '';
      const country = item.countryOfOrigin || '';
      const titleFormat = /MANGA|NOVEL|ONE_SHOT/.test(mediaFormat)
        ? (country === 'KR' ? 'Manhwa' : country === 'CN' ? 'Manhua' : 'Manga') : 'Anime';
      const titleName = item.title?.english || item.title?.romaji || item.title?.native || 'Untitled';
      return [{
        id: `anilist-trailer-${item.id}`, titleId: `anilist:${item.id}`, videoUrl,
        platform: 'youtube' as const, videoTitle: titleName, creatorName: 'YouTube',
        creatorAvatarUrl: '', actionType: 'watch' as const,
        actionUrl: item.siteUrl || videoUrl, sortOrder: 0,
        createdAt: '1970-01-01T00:00:00.000Z', titleName,
        titleCover: item.coverImage?.extraLarge || item.coverImage?.large || '',
        titleFormat, releaseYear: item.seasonYear, genres: item.genres || []
      }];
    });
  });
}
const mapAniListMedia = (item: import('./anilist').Anime): Anime => {
  const manga = item.format === 'MANGA' || item.format === 'NOVEL' || item.format === 'ONE_SHOT';
  const format = manga
    ? item.format === 'NOVEL' ? 'Light Novel' : item.countryOfOrigin === 'KR' ? 'Manhwa' : item.countryOfOrigin === 'CN' ? 'Manhua' : 'Manga'
    : item.format === 'MOVIE' ? 'Movie' : item.format === 'TV' ? 'TV Series' : item.format || 'Anime';
  return {
    id: `anilist-${manga ? 'm' : 'a'}-${item.id}`,
    anilistId: item.id,
    title: item.title || {},
    description: item.description || '',
    coverImage: item.coverImage || {},
    bannerImage: item.bannerImage || '',
    averageScore: item.averageScore,
    episodes: item.episodes,
    status: item.status || 'Unknown',
    seasonYear: item.seasonYear,
    format,
    genres: item.genres || [],
    studios: item.studios || { nodes: [] },
    duration: item.duration,
    siteUrl: item.siteUrl || '',
    nextAiringEpisode: item.nextAiringEpisode,
    trailer: item.trailer,
    countryOfOrigin: item.countryOfOrigin || '',
    source: item.source || '',
    synonyms: item.synonyms || [],
    startDate: item.startDate,
    staff: item.staff || { edges: [] },
    externalLinks: item.externalLinks || [],
    characters: item.characters || emptyCharacters()
  };
};

const mapTitle = (row: TitleRow): Anime => {
  const trailerId = youtubeId(row.trailer_url || '');
  return {
    id: row.id,
    anilistId: Number(row.anilist_id) > 0 ? Number(row.anilist_id) : undefined,
    title: { english: row.name, romaji: row.name, native: row.alternative_names?.[0] },
    description: row.synopsis || '',
    coverImage: { extraLarge: row.cover_url || '', large: row.cover_url || '' },
    bannerImage: row.banner_url || '',
    averageScore: row.rating == null ? undefined : Math.round(row.rating * 10),
    episodes: Number(row.episodes) || undefined,
    status: row.status || 'Unknown',
    seasonYear: row.release_year || undefined,
    format: row.media_type || 'Anime',
    genres: row.genres || [],
    studios: { nodes: row.studio ? [{ name: row.studio }] : [] },
    siteUrl: row.source_url || '',
    trailer: trailerId ? { id: trailerId, site: 'youtube' } : undefined,
    trailerUrl: row.trailer_url || '',
    countryOfOrigin: row.country || '',
    source: row.author || '',
    synonyms: row.alternative_names || [],
    startDate: row.release_year ? { year: row.release_year } : undefined,
    staff: { edges: [] },
    externalLinks: row.source_url ? [{ url: row.source_url, site: 'Source' }] : [],
    characters: { pageInfo: { currentPage: 1, hasNextPage: false }, edges: [] }
  };
};
const inFlightCache = new Map<string, Promise<unknown>>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const old = cache.get(key);
  if (old && Date.now() - old.at < TTL) return old.value as T;
  const pending = inFlightCache.get(key);
  if (pending) return pending as Promise<T>;
  const request = load().then(value => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 100) cache.delete(cache.keys().next().value || '');
    return value;
  }).finally(() => inFlightCache.delete(key));
  inFlightCache.set(key, request);
  return request;
}
function throwIf(error: { message: string } | null) { if (error) throw new Error(error.message); }
async function fetchTitles(query: any): Promise<Anime[]> {
  const { data, error } = await query;
  throwIf(error);
  return ((data || []) as TitleRow[]).map(mapTitle);
}
export async function getTrending(): Promise<Anime[]> {
  return cached('trending', async () => {
    const [local, remote] = await Promise.allSettled([
      fetchTitles(supabase.from('titles').select('id,name,alternative_names,media_type,synopsis,cover_url,banner_url,genres,status,release_year,rating,episodes,studio,country,source_url,anilist_id,trailer_url,popularity,is_trending,is_featured').or('is_featured.eq.true,is_trending.eq.true').order('popularity', { ascending: false }).limit(18)),
      fetchAniListTrending()
    ]);
    const merged = [
      ...(remote.status === 'fulfilled' ? remote.value.map(mapAniListMedia) : []),
      ...(local.status === 'fulfilled' ? local.value : [])
    ];
    const seen = new Set<string>();
    return merged.filter(item => !seen.has(item.id) && !!seen.add(item.id)).slice(0, 36);
  });
}
export async function getPopular(): Promise<Anime[]> {
  return cached('popular', async () => {
    const [local, remote] = await Promise.allSettled([
      fetchTitles(supabase.from('titles').select('id,name,alternative_names,media_type,synopsis,cover_url,banner_url,genres,status,release_year,rating,episodes,studio,country,source_url,anilist_id,trailer_url,popularity').order('popularity', { ascending: false }).limit(18)),
      fetchAniListPopular()
    ]);
    const merged = [
      ...(remote.status === 'fulfilled' ? remote.value.map(mapAniListMedia) : []),
      ...(local.status === 'fulfilled' ? local.value : [])
    ];
    const seen = new Set<string>();
    return merged.filter(item => !seen.has(item.id) && !!seen.add(item.id)).slice(0, 36);
  });
}
export async function getTrendingManga(): Promise<Anime[]> {
  return cached('trending-manga', async () => (await fetchTrendingManga()).map(mapAniListMedia));
}
export async function getPopularManga(): Promise<Anime[]> {
  return cached('popular-manga', async () => (await fetchPopularManga()).map(mapAniListMedia));
}
export async function getSeasonal(): Promise<Anime[]> {
  return cached('seasonal', () => fetchTitles(supabase.from('titles').select('id,name,alternative_names,media_type,synopsis,cover_url,banner_url,genres,status,release_year,rating,episodes,studio,country,source_url,anilist_id,trailer_url').in('status', ['Airing','Ongoing']).order('release_year', { ascending: false }).limit(18)));
}
export async function getVideoCatalogue(page = 1, genre?: string): Promise<Anime[]> {
  const from = (page - 1) * 50;
  let request = supabase.from('titles').select('*').not('trailer_url', 'is', null).neq('trailer_url', '').order('popularity', { ascending: false }).range(from, from + 49);
  if (genre) request = request.contains('genres', [genre]);
  return fetchTitles(request);
}
export async function searchAnime(search: string, page = 1, genre?: string, status?: string, format?: string): Promise<Anime[]> {
  const mediaType: 'ANIME' | 'MANGA' | undefined =
    ['Manga','Manhwa','Manhua','Light Novel','Web Novel'].includes(format || '') ? 'MANGA' :
    ['Anime','Movie','TV Series'].includes(format || '') ? 'ANIME' : undefined;
  const country = format === 'Manhwa' ? 'KR' : format === 'Manhua' ? 'CN' : undefined;
  const apiFormat = format === 'Movie' ? 'MOVIE' : format === 'TV Series' ? 'TV' : format === 'Light Novel' || format === 'Web Novel' ? 'NOVEL' : undefined;
  const results = await searchMedia(search, page, genre, status, apiFormat, mediaType, country);
  let mapped = results.map(mapAniListMedia);
  return mapped;
}
const isMangaTitle = (format = '') => /manga|manhwa|manhua|webtoon|comic/i.test(format);
const emptyCharacters = (page = 1): NonNullable<Anime['characters']> => ({
  pageInfo: { currentPage: page, hasNextPage: false }, edges: []
});

export async function getAnime(id: string): Promise<Anime | null> {
  if (!id) return null;
  if (id.startsWith('anilist-a-') || id.startsWith('anilist-m-')) {
    const mediaType = id.startsWith('anilist-m-') ? 'MANGA' : 'ANIME';
    const numericId = Number(id.slice('anilist-a-'.length));
    const mangaId = Number(id.slice('anilist-m-'.length));
    return cached(`detail:${id}`, async () => {
      const result = await getAniListMediaById(mediaType === 'MANGA' ? mangaId : numericId, mediaType);
      return result ? mapAniListMedia(result) : null;
    });
  }
  return cached(`detail:${id}`, async () => {
    const { data, error } = await supabase.from('titles').select('id,name,alternative_names,media_type,synopsis,cover_url,banner_url,genres,status,release_year,rating,episodes,studio,country,source_url,anilist_id,trailer_url').eq('id', id).maybeSingle();
    throwIf(error);
    if (!data) return null;
    const row = data as TitleRow;
    const anime = mapTitle(row);
    const { data: characters, error: characterError } = await supabase
      .from('characters').select('*').eq('title_id', id).order('created_at').limit(50);
    throwIf(characterError);
    const localEdges = ((characters || []) as CharacterRow[]).map(row => ({
      role: row.role || 'Supporting',
      node: {
        id: hashId(row.id), name: { full: row.name },
        image: { large: row.image_url || '', medium: row.image_url || '' },
        description: row.description || '', role: row.role || 'Supporting'
      }
    }));
    let remote = emptyCharacters();
    if (anime.anilistId) {
      try {
        remote = await getMediaCharacters(anime.anilistId, 1, isMangaTitle(anime.format) ? 'MANGA' : 'ANIME');
      } catch (error) {
        console.warn('AniList character enrichment unavailable; keeping catalogue characters.', error);
      }
    }
    const seen = new Set<number>();
    const merged = [...localEdges, ...remote.edges].filter(edge => {
      if (seen.has(edge.node.id)) return false;
      seen.add(edge.node.id);
      return true;
    });
    anime.characters = {
      pageInfo: remote.pageInfo,
      edges: merged
    };
    return anime;
  });
}

export async function getAnimeCharacters(id: string, page: number): Promise<NonNullable<Anime['characters']>> {
  if (!id || !Number.isInteger(page) || page < 1) return emptyCharacters(Math.max(1, page || 1));
  const anime = await getAnime(id);
  if (!anime) return emptyCharacters(page);
  if (page === 1) return anime.characters || emptyCharacters();
  if (!anime.anilistId) return emptyCharacters(page);
  try {
    return await getMediaCharacters(anime.anilistId, page, isMangaTitle(anime.format) ? 'MANGA' : 'ANIME');
  } catch (error) {
    console.warn('Could not load another AniList character page:', error);
    throw new Error('More character profiles could not be loaded. Please try again.');
  }
}
export const titleOf = (anime: Anime) => anime.title?.english || anime.title?.romaji || anime.title?.native || 'Untitled';
export const imageOf = (anime: Anime) => anime.coverImage?.extraLarge || anime.coverImage?.large || anime.bannerImage || '';
export const cleanDescription = (value = '') => value.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const videoMetadataCache = new Map<string, Partial<RelatedVideo>>();
const videoMetadataPending = new Map<string, Promise<void>>();
export async function enrichVideoMetadata(videos: RelatedVideo[]): Promise<RelatedVideo[]> {
  const youtubeVideos = videos.filter(video => /youtu\\.be|youtube(?:-nocookie)?\\.com/i.test(video.videoUrl));
  const missing = youtubeVideos.filter(video => !videoMetadataCache.has(video.videoUrl) && !videoMetadataPending.has(video.videoUrl));
  if (missing.length) {
    const task = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('video-metadata', {
          body: { urls: missing.map(video => video.videoUrl) }
        });
        if (error) throw error;
        const results = new Map<string, any>((data?.results || []).map((item: any) => [item.input, item]));
        missing.forEach(video => {
          const meta = results.get(video.videoUrl);
          videoMetadataCache.set(video.videoUrl, meta?.ok ? {
            videoTitle: meta.title || video.videoTitle,
            creatorName: meta.channelName || video.creatorName,
            creatorAvatarUrl: meta.channelAvatarUrl || video.creatorAvatarUrl
          } : {});
        });
      } catch (error) {
        console.warn('Could not refresh YouTube video metadata:', error);
      } finally {
        missing.forEach(video => videoMetadataPending.delete(video.videoUrl));
      }
    })();
    missing.forEach(video => videoMetadataPending.set(video.videoUrl, task));
    await task;
  }
  const pending = youtubeVideos.filter(video => videoMetadataPending.has(video.videoUrl));
  if (pending.length) await Promise.all([...new Set(pending.map(video => videoMetadataPending.get(video.videoUrl)!))]);
  return videos.map(video => {
    const meta = videoMetadataCache.get(video.videoUrl);
    return meta ? { ...video, ...meta } : video;
  });
}
