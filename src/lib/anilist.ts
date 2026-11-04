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
export type AnimeExternalLink = { url: string; site: string; type?: string; language?: string };
export type Anime = {
  id: number;
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
  chapters?: number;
  nextAiringEpisode?: { episode: number; airingAt: number };
  trailer?: { id: string; site: string };
  countryOfOrigin?: string;
  source?: string;
  synonyms?: string[];
  startDate?: { year?: number; month?: number; day?: number };
  staff?: { edges: AnimeStaff[] };
  externalLinks?: AnimeExternalLink[];
  characters?: {
    pageInfo: { currentPage: number; hasNextPage: boolean };
    edges: { role: string; node: AnimeCharacter }[];
  };
};

const endpoint = 'https://graphql.anilist.co';
const fields = `
  id title { romaji english native } description(asHtml: false)
  coverImage { extraLarge large color } bannerImage averageScore episodes chapters
  status seasonYear format genres duration countryOfOrigin siteUrl
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt }
  trailer { id site }
`;
const detailFields = `
  ${fields}
  countryOfOrigin source synonyms startDate { year month day }
  staff(sort: RELEVANCE, perPage: 35) { edges { role node { name { full } } } }
  externalLinks { url site type language }
  characters(page: 1, perPage: 50, sort: ROLE) {
    pageInfo { currentPage hasNextPage }
    edges {
      role
      node {
        id name { full native alternative } image { large medium }
        description(asHtml: false) gender age dateOfBirth { year month day }
        siteUrl favourites
      }
    }
  }
`;

type AniListResponse<T> = { data?: T; errors?: { message?: string }[] };
const memoryCache = new Map<string, { expires: number; value: unknown }>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const CACHE_TTL = 10 * 60 * 1000;
const DETAIL_CACHE_TTL = 30 * 60 * 1000;

async function queryUncached<T>(queryText: string, variables: Record<string, unknown> = {}, cacheTtl = CACHE_TTL): Promise<T> {
  const cacheKey = JSON.stringify([queryText, variables]);
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value as T;

  let lastError: Error = new Error('Anime catalogue is temporarily unavailable.');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: queryText, variables }),
        signal: controller.signal
      });

      // AniList can return useful GraphQL error details with non-2xx responses.
      // Read the body before deciding whether to retry so users see the real cause.
      const rawBody = await response.text();
      window.clearTimeout(timeout);
      let payload: AniListResponse<T> | null = null;
      try { payload = rawBody ? JSON.parse(rawBody) as AniListResponse<T> : null; } catch { /* non-JSON proxy/server response */ }

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        const apiMessage = payload?.errors?.map(error => error.message).filter(Boolean).join(' · ');
        lastError = new Error(response.status === 429
          ? 'AniList is receiving too many requests. Please wait a moment.'
          : apiMessage
            ? `AniList rejected the catalogue query: ${apiMessage}`
            : response.status === 400
              ? 'AniList rejected the catalogue request (400). The API did not provide a readable query error.'
              : `Anime catalogue request failed (${response.status}).`);
        if (retryable && attempt < 2) {
          await new Promise(resolve => window.setTimeout(resolve, retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 500 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }

      if (!payload) {
        lastError = new Error('AniList returned an unreadable response. Please try again.');
        throw lastError;
      }
      if (payload.data) {
        memoryCache.set(cacheKey, { expires: Date.now() + cacheTtl, value: payload.data });
        if (memoryCache.size > 200) {
          const oldestKey = memoryCache.keys().next().value;
          if (oldestKey) memoryCache.delete(oldestKey);
        }
        return payload.data;
      }
      lastError = new Error(payload.errors?.map(error => error.message).filter(Boolean).join(' · ') || 'AniList returned an incomplete response.');
      if (attempt < 2 && /rate|temporar|timeout|internal/i.test(lastError.message)) {
        await new Promise(resolve => window.setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      throw lastError;
    } catch (error) {
      window.clearTimeout(timeout);
      lastError = error instanceof Error
        ? (error.name === 'AbortError' ? new Error('AniList took too long to respond. Please try again.') : error)
        : new Error('Could not connect to AniList.');
      if (attempt < 2 && (lastError.name === 'AbortError' || /fetch|network|temporar|timed out/i.test(lastError.message))) {
        await new Promise(resolve => window.setTimeout(resolve, 450 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

async function query<T>(queryText: string, variables: Record<string, unknown> = {}, cacheTtl = CACHE_TTL): Promise<T> {
  const key = JSON.stringify([queryText, variables]);
  const existing = inFlightRequests.get(key);
  if (existing) return existing as Promise<T>;
  const request = queryUncached<T>(queryText, variables, cacheTtl);
  inFlightRequests.set(key, request);
  try { return await request; }
  finally { inFlightRequests.delete(key); }
}

export async function getVideoCatalogue(page = 1, genre?: string, mediaType: 'ANIME' | 'MANGA' = 'ANIME'): Promise<Anime[]> {
  const data = await query<{ Page: { media: Anime[] } }>(
    `query($page: Int, $genre: String, $type: MediaType!) { Page(page: $page, perPage: 50) { media(type: $type, genre: $genre, sort: TRENDING_DESC, isAdult: false) { ${fields} } } }`,
    { page, genre: genre || undefined, type: mediaType }
  );
  return data.Page?.media || [];
}

/**
 * Anime + manga trailer pages in ONE GraphQL request (aliases) instead of two.
 * AniList rate-limits per request, so batching keeps the Video tab fast and avoids 429s.
 */
export async function getTrailerCatalogue(page = 1): Promise<{ anime: Anime[]; manga: Anime[] }> {
  const data = await query<{ anime: { media: Anime[] }; manga: { media: Anime[] } }>(
    `query($page: Int) {
      anime: Page(page: $page, perPage: 50) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${fields} } }
      manga: Page(page: $page, perPage: 50) { media(type: MANGA, sort: TRENDING_DESC, isAdult: false) { ${fields} } }
    }`,
    { page }
  );
  return { anime: data.anime?.media || [], manga: data.manga?.media || [] };
}

/** Every AniList list shown on Home, fetched in a single request. */
export async function getHomeCollections(): Promise<{ trending: Anime[]; popular: Anime[]; trendingManga: Anime[]; popularManga: Anime[] }> {
  const data = await query<Record<'trending' | 'popular' | 'trendingManga' | 'popularManga', { media: Anime[] }>>(
    `query {
      trending: Page(perPage: 12) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${fields} } }
      popular: Page(perPage: 12) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${fields} } }
      trendingManga: Page(perPage: 18) { media(type: MANGA, sort: TRENDING_DESC, isAdult: false) { ${fields} } }
      popularManga: Page(perPage: 18) { media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) { ${fields} } }
    }`
  );
  return {
    trending: data.trending?.media || [], popular: data.popular?.media || [],
    trendingManga: data.trendingManga?.media || [], popularManga: data.popularManga?.media || []
  };
}

export async function getMangaVideoCatalogue(page = 1, genre?: string): Promise<Anime[]> {
  return getVideoCatalogue(page, genre, 'MANGA');
}
export async function getTrendingManga(): Promise<Anime[]> {
  const data = await query<{ Page: { media: Anime[] } }>(
    `query { Page(perPage: 18) { media(type: MANGA, sort: TRENDING_DESC, isAdult: false) { ${fields} } } }`
  );
  return data.Page?.media || [];
}

export async function getPopularManga(): Promise<Anime[]> {
  const data = await query<{ Page: { media: Anime[] } }>(
    `query { Page(perPage: 18) { media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) { ${fields} } } }`
  );
  return data.Page?.media || [];
}

export async function searchMedia(
  search = '',
  page = 1,
  genre?: string,
  status?: string,
  format?: string,
  mediaType?: 'ANIME' | 'MANGA',
  country?: 'KR' | 'CN',
  sort?: string
): Promise<Anime[]> {
  const validSorts = ['POPULARITY_DESC','TRENDING_DESC','SCORE_DESC','START_DATE_DESC','FAVOURITES_DESC'];
  const chosenSort = sort && validSorts.includes(sort) ? sort : '';
  const validFormats = ['TV','TV_SHORT','MOVIE','SPECIAL','OVA','ONA','MUSIC','MANGA','NOVEL','ONE_SHOT'];
  const apiFormat = format && validFormats.includes(format) ? format : undefined;
  const data = await query<{ Page: { media: Anime[] } }>(
    `query($search: String, $page: Int, $genre: String, $status: MediaStatus, $format: MediaFormat, $type: MediaType, $country: CountryCode, $sort: [MediaSort]) {
      Page(page: $page, perPage: 50) {
        media(type: $type, search: $search, genre: $genre, status: $status, format: $format, countryOfOrigin: $country, sort: $sort, isAdult: false) { ${fields} }
      }
    }`,
    {
      search: search.trim() || undefined,
      page,
      genre: genre || undefined,
      status: status || undefined,
      format: apiFormat,
      type: mediaType,
      country,
      sort: chosenSort ? (search.trim() ? [chosenSort, 'SEARCH_MATCH'] : [chosenSort]) : (search.trim() ? ['SEARCH_MATCH'] : ['POPULARITY_DESC'])
    }
  );
  return data.Page?.media || [];
}

export async function getAniListMediaById(id: number, mediaType: 'ANIME' | 'MANGA' = 'ANIME'): Promise<Anime | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const data = await query<{ Media: Anime | null }>(
    `query($id: Int!, $type: MediaType!) { Media(id: $id, type: $type) { ${detailFields} } }`,
    { id, type: mediaType },
    DETAIL_CACHE_TTL
  );
  return data.Media || null;
}


export async function getTrending(): Promise<Anime[]> {
  const data = await query<{ Page: { media: Anime[] } }>(`query { Page(perPage: 12) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${fields} } } }`);
  return data.Page?.media || [];
}

export async function getPopular(): Promise<Anime[]> {
  const data = await query<{ Page: { media: Anime[] } }>(`query { Page(perPage: 12) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${fields} } } }`);
  return data.Page?.media || [];
}

export async function getSeasonal(): Promise<Anime[]> {
  const now = new Date();
  const month = now.getMonth();
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL';
  const data = await query<{ Page: { media: Anime[] } }>(
    `query($season: MediaSeason!, $year: Int!) { Page(perPage: 12) { media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${fields} } } }`,
    { season, year: now.getFullYear() }
  );
  return data.Page?.media || [];
}

export async function searchAnime(search: string, page = 1, genre?: string, status?: string, format?: string): Promise<Anime[]> {
  const data = await query<{ Page: { media: Anime[] } }>(
    `query($search: String, $page: Int, $genre: String, $status: MediaStatus, $format: MediaFormat) { Page(page: $page, perPage: 50) { media(type: ANIME, search: $search, genre: $genre, status: $status, format: $format, sort: SEARCH_MATCH, isAdult: false) { ${fields} } } }`,
    { search: search || undefined, page, genre: genre || undefined, status: status || undefined, format: format || undefined }
  );
  return data.Page?.media || [];
}

export async function getAnime(id: number): Promise<Anime | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const data = await query<{ Media: Anime | null }>(
    `query($id: Int) { Media(id: $id, type: ANIME) { ${detailFields} } }`,
    { id },
    DETAIL_CACHE_TTL
  );
  return data.Media || null;
}

export async function getMediaCharacters(
  id: number,
  page = 1,
  mediaType: 'ANIME' | 'MANGA' = 'ANIME'
): Promise<NonNullable<Anime['characters']>> {
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(page) || page < 1) {
    return { pageInfo: { currentPage: Math.max(1, page || 1), hasNextPage: false }, edges: [] };
  }
  const data = await query<{ Media: { characters: NonNullable<Anime['characters']> } | null }>(
    `query($id: Int!, $page: Int!, $type: MediaType!) {
      Media(id: $id, type: $type) {
        characters(page: $page, perPage: 30, sort: ROLE) {
          pageInfo { currentPage hasNextPage }
          edges {
            role
            node {
              id name { full native alternative } image { large medium }
              description(asHtml: false) gender age dateOfBirth { year month day }
              siteUrl favourites
            }
          }
        }
      }
    }`,
    { id, page, type: mediaType },
    DETAIL_CACHE_TTL
  );
  return data.Media?.characters || { pageInfo: { currentPage: page, hasNextPage: false }, edges: [] };
}

export async function getAnimeCharacters(id: number, page: number): Promise<NonNullable<Anime['characters']>> {
  return getMediaCharacters(id, page, 'ANIME');
}

export async function getMangaCharacters(id: number, page = 1): Promise<NonNullable<Anime['characters']>> {
  return getMediaCharacters(id, page, 'MANGA');
}

export const titleOf = (anime: Anime) => anime.title?.english || anime.title?.romaji || anime.title?.native || 'Untitled anime';
export const imageOf = (anime: Anime) => anime.coverImage?.extraLarge || anime.coverImage?.large || anime.bannerImage || '';
export const cleanDescription = (value = '') => value
  .replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#039;|&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/\s+/g, ' ').trim();
