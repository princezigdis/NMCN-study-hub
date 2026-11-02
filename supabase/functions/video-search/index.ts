// POST /functions/v1/video-search { query: string }
// Medical-only video hub. Every search is decorated with clinical-procedure terms and
// results are filtered to medical/nursing/midwifery content. Cached 24h server-side.
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, getSetting, requireUser } from "../_shared/supabase.ts";
import { searchVideos, type VideoResult } from "../_shared/youtube.ts";

const DECORATOR = "nursing midwifery clinical procedure demonstration";
const MEDICAL = /(nurs|midwif|clinic|patient|procedure|medical|health|hospital|anatomy|physiolog|pharmac|catheter|injection|wound|dressing|suction|vital|bp |blood pressure|labou?r|deliver|antenatal|postnatal|neonat|newborn|infant|cpr|resuscitat|iv |intravenous|cannula|specimen|sterile|aseptic|hygiene|assessment|obstetric|gyn|paediatric|pediatric|surgical|infection|osce|nmcn|care)/i;
const BLOCKED = /(prank|funny|music video|trailer|asmr|movie|song|reaction|gameplay)/i;

Deno.serve(handler(Deno.env.get("ALLOWED_ORIGINS") ?? "*", async (req) => {
  const { user } = await requireUser(req);
  const admin = adminClient();
  const body = await readJson<{ query?: string }>(req, 2048);
  const q = String(body.query ?? "").replace(/\s+/g, " ").trim();
  if (q.length < 3 || q.length > 120) throw new HttpError(400, "invalid_query", "Type the name of a procedure or topic.");

  const key = Deno.env.get("YOUTUBE_DATA_API_KEY");
  if (!key) throw new HttpError(503, "videos_not_configured", "Videos are not available right now.");

  const cfg = (await getSetting<{ medical_only?: boolean }>(admin, "video.filter")) ?? {};
  const strict = cfg.medical_only !== false;

  // Throttle: 30 searches per user per hour.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("youtube_cache_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= 30) throw new HttpError(429, "rate_limited", "Too many searches. Try again shortly.");

  await admin.from("youtube_cache_log").insert({ user_id: user.id });
  const decorated = strict ? `${q} ${DECORATOR}` : q;
  const cacheKey = decorated.toLowerCase();
  const { data: hit } = await admin.from("youtube_cache").select("results, fetched_at").eq("query_key", cacheKey).maybeSingle();
  if (hit && Date.now() - new Date(hit.fetched_at).getTime() < 24 * 3600_000) return json({ videos: hit.results });

  let videos: VideoResult[] = await searchVideos(key, decorated);
  if (strict) videos = videos.filter((v) => MEDICAL.test(`${v.title} ${v.channel}`) && !BLOCKED.test(v.title));
  await admin.from("youtube_cache").upsert({ query_key: cacheKey, results: videos, fetched_at: new Date().toISOString() });
  return json({ videos });
}));
