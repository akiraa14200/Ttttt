import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const STATE_KEY = "anilist_catalogue_sync";
const PAGES_PER_TYPE = 5;
const PAGE_SIZE = 50;
const FIELDS = `
  id
  title { english romaji native }
  synonyms
  description(asHtml: false)
  coverImage { extraLarge large }
  bannerImage
  genres
  averageScore
  status
  startDate { year }
  seasonYear
  format
  episodes
  chapters
  countryOfOrigin
  source
  popularity
  trailer { id site }
  siteUrl
  studios(isMain: true) { nodes { name } }
`;

type Media = {
  id: number;
  title?: { english?: string | null; romaji?: string | null; native?: string | null };
  synonyms?: string[];
  description?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null };
  bannerImage?: string | null;
  genres?: string[];
  averageScore?: number | null;
  status?: string | null;
  startDate?: { year?: number | null };
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  countryOfOrigin?: string | null;
  source?: string | null;
  popularity?: number | null;
  trailer?: { id?: string | null; site?: string | null } | null;
  siteUrl?: string | null;
  studios?: { nodes?: { name: string }[] };
};
type PageResult = { pageInfo?: { total?: number; hasNextPage?: boolean }; media?: Media[] };
type SyncState = {
  animePage: number;
  mangaPage: number;
  animeDone: boolean;
  mangaDone: boolean;
  animeTotal: number;
  mangaTotal: number;
  animeProcessed: number;
  mangaProcessed: number;
  titlesInserted: number;
  trailersInserted: number;
  updatedAt: string;
};
const initialState = (): SyncState => ({
  animePage: 1, mangaPage: 1, animeDone: false, mangaDone: false,
  animeTotal: 0, mangaTotal: 0, animeProcessed: 0, mangaProcessed: 0,
  titlesInserted: 0, trailersInserted: 0, updatedAt: new Date().toISOString(),
});
const unique = (values: (string | null | undefined)[]) => [...new Set(values.map(v => (v || "").trim()).filter(Boolean))];
const cleanText = (value: string | null | undefined) => (value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function titleName(media: Media) {
  return media.title?.english?.trim() || media.title?.romaji?.trim() || media.title?.native?.trim() || `AniList entry #${media.id}`;
}
function mediaType(media: Media, type: "ANIME" | "MANGA") {
  if (type === "ANIME") return media.format === "MOVIE" ? "Movie" : "Anime";
  if (media.format === "NOVEL") return "Light Novel";
  if (media.countryOfOrigin === "KR") return "Manhwa";
  if (["CN", "TW", "HK"].includes(media.countryOfOrigin || "")) return "Manhua";
  return "Manga";
}
function statusValue(status: string | null | undefined, type: "ANIME" | "MANGA") {
  if (status === "RELEASING") return type === "ANIME" ? "Airing" : "Ongoing";
  if (status === "FINISHED") return "Completed";
  if (status === "NOT_YET_RELEASED") return "Upcoming";
  if (status === "HIATUS") return "Hiatus";
  if (status === "CANCELLED") return "Cancelled";
  return type === "ANIME" ? "Upcoming" : "Ongoing";
}
function trailerUrl(media: Media) {
  const id = media.trailer?.id || "";
  if (media.trailer?.site?.toLowerCase() !== "youtube" || !/^[a-zA-Z0-9_-]{6,}$/.test(id)) return "";
  return `https://www.youtube.com/watch?v=${id}`;
}
async function fetchPageBlock(type: "ANIME" | "MANGA", startPage: number) {
  const pages = Array.from({ length: PAGES_PER_TYPE }, (_, i) => startPage + i);
  const aliases = pages.map(page => `p${page}: Page(page: ${page}, perPage: ${PAGE_SIZE}) { pageInfo { total hasNextPage } media(type: ${type}, sort: ID, isAdult: false) { ${FIELDS} } }`).join("\n");
  const graphQuery = `query { ${aliases} }`;
  let lastError = "AniList request failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query: graphQuery }),
        signal: AbortSignal.timeout(25000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.errors?.length) {
        lastError = payload?.errors?.map((e: { message?: string }) => e.message).filter(Boolean).join("; ") || `AniList HTTP ${response.status}`;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const retryAfter = Number(response.headers.get("Retry-After") || 0);
          await new Promise(resolve => setTimeout(resolve, retryAfter ? Math.min(retryAfter * 1000, 8000) : 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(lastError);
      }
      const all: Media[] = [];
      let lastInfo = { total: 0, hasNextPage: false };
      for (const page of pages) {
        const result = payload?.data?.[`p${page}`] as PageResult | undefined;
        if (!result) continue;
        all.push(...(result.media || []));
        if (result.pageInfo) lastInfo = { total: result.pageInfo.total || 0, hasNextPage: !!result.pageInfo.hasNextPage };
      }
      return { media: all, total: lastInfo.total, hasNextPage: lastInfo.hasNextPage, nextPage: startPage + pages.length };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && /timeout|network|fetch/i.test(lastError)) {
        await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
        continue;
      }
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}
function toTitleRow(media: Media, type: "ANIME" | "MANGA") {
  const name = titleName(media);
  return {
    anilist_id: media.id,
    name,
    media_type: mediaType(media, type),
    status: statusValue(media.status, type),
    alternative_names: unique([media.title?.romaji, media.title?.native, ...(media.synonyms || [])]).filter(v => v !== name),
    synopsis: cleanText(media.description),
    cover_url: media.coverImage?.extraLarge || media.coverImage?.large || "",
    banner_url: media.bannerImage || "",
    genres: media.genres || [],
    themes: [],
    release_year: media.startDate?.year || media.seasonYear || null,
    rating: media.averageScore ? Math.round((media.averageScore / 10) * 10) / 10 : null,
    popularity: media.popularity || 0,
    chapters: type === "MANGA" && media.chapters ? String(media.chapters) : null,
    episodes: type === "ANIME" && media.episodes ? String(media.episodes) : null,
    studio: (media.studios?.nodes || []).map(x => x.name).filter(Boolean).join(", ") || null,
    country: media.countryOfOrigin || null,
    source_url: media.siteUrl || null,
    trailer_url: trailerUrl(media) || null,
    is_trending: false,
    is_featured: false,
  };
}
async function processMediaBatch(admin: ReturnType<typeof createClient>, media: Media[], type: "ANIME" | "MANGA") {
  const uniqueMedia = [...new Map(media.map(item => [item.id, item])).values()];
  if (!uniqueMedia.length) return { processed: 0, inserted: 0, trailersInserted: 0 };
  const rows = uniqueMedia.map(item => toTitleRow(item, type));
  const { data: insertedRows, error: insertError } = await admin
    .from("titles").upsert(rows, { onConflict: "anilist_id", ignoreDuplicates: true }).select("id,anilist_id");
  if (insertError) throw insertError;
  const ids = uniqueMedia.map(item => item.id);
  const { data: saved, error: savedError } = await admin
    .from("titles").select("id,anilist_id,name,trailer_url").in("anilist_id", ids);
  if (savedError) throw savedError;
  const byAniListId = new Map((saved || []).map((row: any) => [Number(row.anilist_id), row]));
  const trailerRows = uniqueMedia.flatMap(item => {
    const url = trailerUrl(item);
    const title: any = byAniListId.get(item.id);
    if (!url || !title) return [];
    if (!title.trailer_url) {
      // Only fill a missing trailer; never overwrite an administrator's custom URL.
      return [{ title_id: title.id, video_url: url, platform: "youtube", video_title: `${title.name} — Official Trailer`, creator_name: "AniList", creator_avatar_url: "", action_type: "watch", action_url: url, sort_order: 0 }];
    }
    return [{ title_id: title.id, video_url: url, platform: "youtube", video_title: `${title.name} — Official Trailer`, creator_name: "AniList", creator_avatar_url: "", action_type: "watch", action_url: url, sort_order: 0 }];
  });
  if (trailerRows.length) {
    const { error: trailerError } = await admin.from("related_videos")
      .upsert(trailerRows, { onConflict: "title_id,video_url", ignoreDuplicates: true });
    if (trailerError) throw trailerError;
    // Preserve custom title trailer URLs. The video catalogue can still contain an AniList trailer record.
  }
  return { processed: uniqueMedia.length, inserted: insertedRows?.length || 0, trailersInserted: trailerRows.length };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Sign in as an administrator first." }, { status: 401, headers: corsHeaders });
    const url = Deno.env.get("SUPABASE_URL") || "";
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || publishableKeys.default || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default || "";
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase function secrets are not configured.");
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Your session is invalid. Please sign in again." }, { status: 401, headers: corsHeaders });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: membership, error: membershipError } = await admin.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (membershipError || !membership) return Response.json({ error: "Administrator access is required to sync AniList." }, { status: 403, headers: corsHeaders });

    const body = await req.json().catch(() => ({}));
    const { data: savedState } = await admin.from("site_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const state = body?.reset ? initialState() : { ...initialState(), ...(savedState?.value || {}) } as SyncState;
    let animeBatch = { media: [] as Media[], total: state.animeTotal, hasNextPage: false, nextPage: state.animePage };
    let mangaBatch = { media: [] as Media[], total: state.mangaTotal, hasNextPage: false, nextPage: state.mangaPage };
    if (!state.animeDone) animeBatch = await fetchPageBlock("ANIME", state.animePage);
    if (!state.mangaDone) mangaBatch = await fetchPageBlock("MANGA", state.mangaPage);

    const animeResult = await processMediaBatch(admin, animeBatch.media, "ANIME");
    const mangaResult = await processMediaBatch(admin, mangaBatch.media, "MANGA");
    state.animePage = state.animeDone ? state.animePage : animeBatch.nextPage;
    state.mangaPage = state.mangaDone ? state.mangaPage : mangaBatch.nextPage;
    state.animeTotal = animeBatch.total || state.animeTotal;
    state.mangaTotal = mangaBatch.total || state.mangaTotal;
    state.animeProcessed += animeResult.processed;
    state.mangaProcessed += mangaResult.processed;
    state.titlesInserted += animeResult.inserted + mangaResult.inserted;
    state.trailersInserted += animeResult.trailersInserted + mangaResult.trailersInserted;
    state.animeDone = state.animeDone || !animeBatch.hasNextPage;
    state.mangaDone = state.mangaDone || !mangaBatch.hasNextPage;
    state.updatedAt = new Date().toISOString();
    const { error: stateError } = await admin.from("site_settings").upsert({ key: STATE_KEY, value: state, updated_at: state.updatedAt }, { onConflict: "key" });
    if (stateError) throw stateError;

    return Response.json({
      ok: true,
      done: state.animeDone && state.mangaDone,
      state,
      batch: {
        animeFetched: animeResult.processed,
        mangaFetched: mangaResult.processed,
        titlesInserted: animeResult.inserted + mangaResult.inserted,
        trailersQueued: animeResult.trailersInserted + mangaResult.trailersInserted,
      },
    }, { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AniList sync failed.";
    return Response.json({ error: message }, { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
