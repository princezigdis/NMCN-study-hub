// Provider-independent AI contracts. Every provider adapter implements these,
// so switching or adding providers never touches the feature code.

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface Citation {
  type: "note" | "web";
  title: string;
  url?: string;
  id?: string;
}

export interface TextRequest {
  system: string;
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
  /** Ask the provider to use its server-side web search tool (if supported). */
  webSearch?: boolean;
}

export interface TextResult {
  provider: string;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  citations: Citation[];
}

export interface ImageRequest {
  prompt: string;
  model: string;
  size: string;
  timeoutMs: number;
}

export interface ImageResult {
  provider: string;
  model: string;
  bytes: Uint8Array;
  mime: string;
}

export interface TextProvider {
  readonly name: string;
  generate(req: TextRequest): Promise<TextResult>;
}

export interface ImageProvider {
  readonly name: string;
  generateImage(req: ImageRequest): Promise<ImageResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Normalised provider failure. `retryable` drives fallback to a second provider. */
export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** fetch() with a hard timeout; maps network/timeout failures to ProviderError. */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ProviderError("provider_timeout", `Provider did not respond within ${timeoutMs} ms`, true);
    }
    throw new ProviderError("provider_unreachable", "Could not reach the AI provider", true);
  } finally {
    clearTimeout(timer);
  }
}

/** Translate an HTTP error status into a ProviderError without leaking response bodies to users. */
export function providerHttpError(provider: string, status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("provider_auth", `${provider}: API key rejected`, false, status);
  }
  if (status === 429) return new ProviderError("provider_rate_limited", `${provider}: rate limited`, true, status);
  if (status === 529 || status >= 500) {
    return new ProviderError("provider_unavailable", `${provider}: service unavailable`, true, status);
  }
  return new ProviderError("provider_bad_request", `${provider}: request rejected (${status})`, false, status);
}
