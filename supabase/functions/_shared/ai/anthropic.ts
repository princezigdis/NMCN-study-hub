import {
  type Citation,
  type FetchLike,
  fetchWithTimeout,
  ProviderError,
  providerHttpError,
  type TextProvider,
  type TextRequest,
  type TextResult,
} from "./types.ts";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface AnthropicBlock {
  type: string;
  text?: string;
  citations?: Array<{ url?: string; title?: string }>;
  content?: Array<{ type: string; url?: string; title?: string }>;
}

/** Anthropic Claude (Messages API). Web search uses Anthropic's server-side tool. */
export class AnthropicProvider implements TextProvider {
  readonly name = "anthropic";

  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {
    if (!apiKey) throw new ProviderError("provider_not_configured", "ANTHROPIC_API_KEY is not set");
  }

  async generate(req: TextRequest): Promise<TextResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.webSearch) {
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    }

    const res = await fetchWithTimeout(this.fetchImpl, API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    }, req.timeoutMs);

    if (!res.ok) throw providerHttpError(this.name, res.status);

    const json = await res.json() as {
      model?: string;
      content?: AnthropicBlock[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const citations: Citation[] = [];
    const seen = new Set<string>();
    const addWeb = (url?: string, title?: string) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      citations.push({ type: "web", url, title: title || url });
    };

    let text = "";
    for (const block of json.content ?? []) {
      if (block.type === "text" && block.text) {
        text += block.text;
        for (const c of block.citations ?? []) addWeb(c.url, c.title);
      }
    }
    if (!text.trim()) throw new ProviderError("provider_empty", "The AI returned an empty response", true);

    return {
      provider: this.name,
      model: json.model ?? req.model,
      text: text.trim(),
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      citations,
    };
  }
}
