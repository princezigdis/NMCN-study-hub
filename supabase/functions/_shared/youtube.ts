import { type FetchLike, fetchWithTimeout, providerHttpError } from "./ai/types.ts";

export interface VideoResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
  publishedAt?: string;
}

/** YouTube Data API v3 search with strict safe-search, embeddable videos only. */
export async function searchVideos(
  apiKey: string,
  query: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10000,
): Promise<VideoResult[]> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "6",
    safeSearch: "strict",
    videoEmbeddable: "true",
    relevanceLanguage: "en",
    q: query.slice(0, 200),
    key: apiKey,
  });
  const res = await fetchWithTimeout(fetchImpl, `https://www.googleapis.com/youtube/v3/search?${params}`, {}, timeoutMs);
  if (!res.ok) throw providerHttpError("youtube", res.status);
  const json = await res.json() as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string } } };
    }>;
  };
  return (json.items ?? [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      videoId: i.id!.videoId!,
      title: decodeEntities(i.snippet?.title ?? "Untitled"),
      channel: decodeEntities(i.snippet?.channelTitle ?? ""),
      thumbnail: i.snippet?.thumbnails?.medium?.url ?? "",
      url: `https://www.youtube.com/watch?v=${i.id!.videoId}`,
      publishedAt: i.snippet?.publishedAt,
    }));
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
