import { test } from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../supabase/functions/_shared/ai/anthropic.ts";
import { OpenAIImageProvider } from "../supabase/functions/_shared/ai/openai.ts";
import { DEFAULT_AI_CONFIG, estimateCostUsd, generateText, mergeConfig } from "../supabase/functions/_shared/ai/registry.ts";
import { type FetchLike, ProviderError } from "../supabase/functions/_shared/ai/types.ts";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("Anthropic adapter sends the right request and parses text, usage and citations", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake: FetchLike = async (url, init) => {
    seen = { url, init: init! };
    return ok({
      model: "claude-test",
      content: [
        { type: "text", text: "Hand hygiene prevents infection. ", citations: [{ url: "https://who.int/x", title: "WHO" }] },
        { type: "server_tool_use" },
        { type: "text", text: "Use rub for 20–30 s." },
      ],
      usage: { input_tokens: 120, output_tokens: 40 },
    });
  };
  const r = await new AnthropicProvider("sk-test", fake).generate({
    system: "sys", messages: [{ role: "user", content: "hi" }], model: "claude-test", maxTokens: 300, timeoutMs: 5000, webSearch: true,
  });
  assert.equal(seen!.url, "https://api.anthropic.com/v1/messages");
  const headers = seen!.init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "sk-test");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(String(seen!.init.body));
  assert.equal(body.max_tokens, 300);
  assert.equal(body.tools[0].name, "web_search");
  assert.equal(r.text, "Hand hygiene prevents infection. Use rub for 20–30 s.");
  assert.equal(r.inputTokens, 120);
  assert.deepEqual(r.citations, [{ type: "web", url: "https://who.int/x", title: "WHO" }]);
});

test("provider errors are normalised (auth = not retryable, overload = retryable)", async () => {
  const status = (s: number): FetchLike => async () => new Response("{}", { status: s });
  const req = { system: "s", messages: [{ role: "user" as const, content: "x" }], model: "m", maxTokens: 10, timeoutMs: 1000 };
  await assert.rejects(new AnthropicProvider("k", status(401)).generate(req), (e: ProviderError) => e.code === "provider_auth" && !e.retryable);
  await assert.rejects(new AnthropicProvider("k", status(529)).generate(req), (e: ProviderError) => e.code === "provider_unavailable" && e.retryable);
  await assert.rejects(new AnthropicProvider("k", status(429)).generate(req), (e: ProviderError) => e.retryable);
});

test("slow providers time out", async () => {
  const hang: FetchLike = (_u, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(
    new AnthropicProvider("k", hang).generate({ system: "s", messages: [], model: "m", maxTokens: 10, timeoutMs: 30 }),
    (e: ProviderError) => e.code === "provider_timeout" && e.retryable,
  );
});

test("missing API key is reported as not configured", () => {
  assert.throws(() => new AnthropicProvider(""), (e: ProviderError) => e.code === "provider_not_configured");
});

test("generateText falls back to the secondary provider only for transient failures", async () => {
  const calls: string[] = [];
  const fake: FetchLike = async (url) => {
    calls.push(url);
    if (url.includes("anthropic")) return new Response("{}", { status: 503 });
    return ok({ model: "gpt-x", choices: [{ message: { content: "fallback answer" } }], usage: { prompt_tokens: 5, completion_tokens: 6 } });
  };
  const cfg = { ...DEFAULT_AI_CONFIG, fallback_provider: "openai", fallback_fast_model: "gpt-x" };
  const r = await generateText(cfg, { anthropic: "a", openai: "o" }, "fast", { system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50 }, fake);
  assert.equal(r.provider, "openai");
  assert.equal(r.text, "fallback answer");
  assert.equal(calls.length, 2);

  // No fallback model configured -> original error surfaces
  await assert.rejects(generateText(DEFAULT_AI_CONFIG, { anthropic: "a", openai: "o" }, "fast",
    { system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50 }, fake), ProviderError);

  // Non-retryable (bad key) never falls back
  const authFail: FetchLike = async (url) => (url.includes("anthropic") ? new Response("{}", { status: 401 }) : ok({}));
  await assert.rejects(generateText(cfg, { anthropic: "a", openai: "o" }, "fast",
    { system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 50 }, authFail), (e: ProviderError) => e.code === "provider_auth");
});

test("OpenAI image adapter decodes base64 images", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const img = await new OpenAIImageProvider("k", async () => ok({ data: [{ b64_json: png }] }))
    .generateImage({ prompt: "p", model: "gpt-image-1", size: "1024x1024", timeoutMs: 1000 });
  assert.deepEqual(Array.from(img.bytes), [0x89, 0x50, 0x4e, 0x47]);
});

test("cost estimate uses token pricing when configured, else the per-action estimate", () => {
  const cfg = mergeConfig({ pricing: { m: { input_per_mtok: 1, output_per_mtok: 5 } } });
  assert.equal(estimateCostUsd(cfg, "m", 1_000_000, 200_000, 0.5), 2);
  assert.equal(estimateCostUsd(cfg, "other", 10, 10, 0.012), 0.012);
});

test("mergeConfig clamps unsafe values", () => {
  const c = mergeConfig({ timeout_ms: 999999999, max_input_chars: 1 });
  assert.equal(c.timeout_ms, 120000);
  assert.equal(c.max_input_chars, 500);
});
