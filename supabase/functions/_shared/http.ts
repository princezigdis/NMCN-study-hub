// Small HTTP helpers shared by all Edge Functions.

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string, public readonly extra?: Record<string, unknown>) {
    super(message ?? code);
  }
}

/** CORS: only origins listed in ALLOWED_ORIGINS (comma-separated) are echoed back. */
export function corsHeaders(origin: string | null, allowedOrigins: string): Record<string, string> {
  const allowed = allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = origin && (allowed.includes(origin) || allowed.includes("*")) ? origin : allowed[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "payload_too_large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large");
  try {
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Wrap a handler with CORS preflight, method check and uniform error responses. */
export function handler(
  allowedOrigins: string,
  fn: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = corsHeaders(req.headers.get("origin"), allowedOrigins);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
    try {
      const res = await fn(req);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status, cors);
      }
      console.error("unhandled_error", err instanceof Error ? err.message : err);
      return json({ error: "internal_error", message: "Something went wrong. Please try again." }, 500, cors);
    }
  };
}
