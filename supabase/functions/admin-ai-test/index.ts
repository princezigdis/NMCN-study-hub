// POST /functions/v1/admin-ai-test  { provider, model, prompt? }  — requires ai.manage
// Lets an admin test a provider/model before switching the live configuration.
// Reports only whether secrets exist, never their values. Does not use credits.
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { createTextProvider } from "../_shared/ai/registry.ts";
import { ProviderError } from "../_shared/ai/types.ts";

const SAMPLE = "In two sentences, explain why a blood pressure cuff that is too small gives a falsely high reading.";

Deno.serve(handler(Deno.env.get("ALLOWED_ORIGINS") ?? "*", async (req) => {
  const { userClient } = await requireUser(req);
  const { data: allowed } = await userClient.rpc("has_permission", { perm: "ai.manage" });
  if (!allowed) throw new HttpError(403, "permission_denied");

  const body = await readJson<{ provider?: string; model?: string; prompt?: string }>(req, 8192);
  const secrets = {
    anthropic: Boolean(Deno.env.get("ANTHROPIC_API_KEY")),
    openai: Boolean(Deno.env.get("OPENAI_API_KEY")),
    youtube: Boolean(Deno.env.get("YOUTUBE_API_KEY")),
    paystack: Boolean(Deno.env.get("PAYSTACK_SECRET_KEY")),
  };
  if (!body.provider || !body.model) return json({ secrets });

  const started = Date.now();
  try {
    const provider = createTextProvider(body.provider, {
      anthropic: Deno.env.get("ANTHROPIC_API_KEY"), openai: Deno.env.get("OPENAI_API_KEY"),
    });
    const result = await provider.generate({
      system: "You are a concise nursing tutor.",
      messages: [{ role: "user", content: (body.prompt || SAMPLE).slice(0, 2000) }],
      model: body.model.slice(0, 100), maxTokens: 300, timeoutMs: 30000,
    });
    return json({
      ok: true, secrets, latencyMs: Date.now() - started, model: result.model,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, sample: result.text.slice(0, 1500),
    });
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("unknown", (err as Error).message);
    return json({ ok: false, secrets, latencyMs: Date.now() - started, error: e.code, message: e.message });
  }
}));
