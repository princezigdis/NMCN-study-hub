import {
  type FetchLike,
  fetchWithTimeout,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  ProviderError,
  providerHttpError,
  type TextProvider,
  type TextRequest,
  type TextResult,
} from "./types.ts";

const BASE = "https://api.openai.com/v1";

/** OpenAI Chat Completions for text (used as primary or fallback). */
export class OpenAITextProvider implements TextProvider {
  readonly name = "openai";

  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {
    if (!apiKey) throw new ProviderError("provider_not_configured", "OPENAI_API_KEY is not set");
  }

  async generate(req: TextRequest): Promise<TextResult> {
    if (req.webSearch) {
      // Web search is implemented with Anthropic's server tool; keep OpenAI to plain text.
      throw new ProviderError("provider_feature_unsupported", "Web search is not configured for OpenAI");
    }
    const res = await fetchWithTimeout(this.fetchImpl, `${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        max_completion_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [{ role: "system", content: req.system }, ...req.messages],
      }),
    }, req.timeoutMs);

    if (!res.ok) throw providerHttpError(this.name, res.status);
    const json = await res.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new ProviderError("provider_empty", "The AI returned an empty response", true);
    return {
      provider: this.name,
      model: json.model ?? req.model,
      text,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      citations: [],
    };
  }
}

/** OpenAI image generation (educational diagrams). */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";

  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {
    if (!apiKey) throw new ProviderError("provider_not_configured", "OPENAI_API_KEY is not set");
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const res = await fetchWithTimeout(this.fetchImpl, `${BASE}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: req.model, prompt: req.prompt, size: req.size, n: 1 }),
    }, req.timeoutMs);
    if (!res.ok) throw providerHttpError(this.name, res.status);
    const json = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = json.data?.[0];
    let bytes: Uint8Array | null = null;
    if (item?.b64_json) {
      bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
    } else if (item?.url) {
      const img = await fetchWithTimeout(this.fetchImpl, item.url, {}, req.timeoutMs);
      if (!img.ok) throw providerHttpError(this.name, img.status);
      bytes = new Uint8Array(await img.arrayBuffer());
    }
    if (!bytes || bytes.length === 0) throw new ProviderError("provider_empty", "No image returned", true);
    return { provider: this.name, model: req.model, bytes, mime: "image/png" };
  }
}
