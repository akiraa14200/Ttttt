const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const cache = new Map<string, { at: number; value: Record<string, unknown> }>();
const TTL = 6 * 60 * 60 * 1000;

function canonicalYouTubeUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    let id = "";
    if (host === "youtu.be") id = parts[0] || "";
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") || (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "") || "";
    } else return null;
    return /^[a-zA-Z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

function extractMetaImage(html: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&") || "";
    if (["og:image", "twitter:image", "twitter:image:src"].includes(property) && content.startsWith("https://")) return content;
  }
  const patterns = [
    /"avatar"\s*:\s*\{[\s\S]{0,300}?"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/,
    /"channelThumbnail"\s*:\s*\{[\s\S]{0,300}?"url"\s*:\s*"([^"]+)"/,
    /"thumbnail"\s*:\s*\{[\s\S]{0,300}?"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1]?.replace(/\\u0026/g, "&").replace(/\\\\/g, "") || "";
    if (value.startsWith("https://")) return value;
  }
  return "";
}

async function getMetadata(input: string) {
  const canonical = canonicalYouTubeUrl(input);
  if (!canonical) return { input, ok: false, reason: "not_youtube" };
  const cached = cache.get(canonical);
  if (cached && Date.now() - cached.at < TTL) return { input, ...cached.value };
  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", canonical);
    endpoint.searchParams.set("format", "json");
    const response = await fetch(endpoint, { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return { input, ok: false, reason: `oembed_${response.status}` };
    const data = await response.json();
    const authorUrl = typeof data.author_url === "string" ? data.author_url : "";
    let avatar = "";
    if (/^https:\/\/(?:www\.)?youtube\.com\//i.test(authorUrl)) {
      try {
        const page = await fetch(authorUrl, { headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0 (compatible; RykoCollection/1.0)" } });
        if (page.ok) avatar = extractMetaImage((await page.text()).slice(0, 3000000));
      } catch { /* The video title and channel name can still be displayed. */ }
    }
    const value = {
      ok: true,
      title: typeof data.title === "string" ? data.title : "",
      channelName: typeof data.author_name === "string" ? data.author_name : "",
      channelAvatarUrl: avatar,
      thumbnailUrl: typeof data.thumbnail_url === "string" ? data.thumbnail_url : "",
    };
    cache.set(canonical, { at: Date.now(), value });
    return { input, ...value };
  } catch {
    return { input, ok: false, reason: "metadata_fetch_failed" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  try {
    const body = await req.json();
    const urls = Array.isArray(body?.urls) ? body.urls.slice(0, 50) : [];
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < urls.length; i += 5) {
      results.push(...await Promise.all(urls.slice(i, i + 5).map((url: string) => getMetadata(url))));
    }
    return Response.json({ results }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: corsHeaders });
  }
});
