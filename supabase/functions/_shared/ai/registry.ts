import { AnthropicProvider } from "./anthropic.ts";
import { OpenAIImageProvider, OpenAITextProvider } from "./openai.ts";
import {
  type FetchLike,
  type ImageProvider,
  ProviderError,
  type TextProvider,
  type TextRequest,
  type TextResult,
} from "./types.ts";

/** Shape of app_settings['ai.config'] (editable in Admin → AI). */
export interface AiConfig {
  enabled: boolean;
  text_provider: string;
  fast_model: string;
  strong_model: string;
  fallback_provider?: string;
  fallback_fast_model?: string;
  fallback_strong_model?: string;
  image_provider: string;
  image_model: string;
  image_size: string;
  daily_budget_usd?: number;
  per_user_per_minute?: number;
  max_input_chars: number;
  timeout_ms: number;
  /** Optional USD price per million tokens, per model, for cost estimates. */
  pricing?: Record<string, { input_per_mtok: number; output_per_mtok: number }>;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true,
  text_provider: "anthropic",
  fast_model: "claude-haiku-5-5",
  strong_model: "claude-sonnet-5-5",
  fallback_provider: "openai",
  fallback_fast_model: "",
  fallback_strong_model: "",
  image_provider: "openai",
  image_model: "gpt-image-1",
  image_size: "1024x1024",
  max_input_chars: 12000,
  timeout_ms: 45000,
  pricing: {},
};

export function mergeConfig(raw: unknown): AiConfig {
  const cfg = { ...DEFAULT_AI_CONFIG, ...(raw && typeof raw === "object" ? raw as Partial<AiConfig> : {}) };
  cfg.max_input_chars = clampInt(cfg.max_input_chars, 500, 50000, DEFAULT_AI_CONFIG.max_input_chars);
  cfg.timeout_ms = clampInt(cfg.timeout_ms, 5000, 120000, DEFAULT_AI_CONFIG.timeout_ms);
  return cfg;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
}

export interface ProviderKeys {
  anthropic?: string;
  openai?: string;
}

export function createTextProvider(name: string, keys: ProviderKeys, fetchImpl: FetchLike = fetch): TextProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(keys.anthropic ?? "", fetchImpl);
    case "openai":
      return new OpenAITextProvider(keys.openai ?? "", fetchImpl);
    default:
      throw new ProviderError("provider_unknown", `Unknown text provider "${name}"`);
  }
}

export function createImageProvider(name: string, keys: ProviderKeys, fetchImpl: FetchLike = fetch): ImageProvider {
  switch (name) {
    case "openai":
      return new OpenAIImageProvider(keys.openai ?? "", fetchImpl);
    default:
      throw new ProviderError("provider_unknown", `Unknown image provider "${name}"`);
  }
}

export type ModelTier = "fast" | "strong";

/**
 * Generate text with the configured primary provider, falling back to the
 * secondary provider only for transient failures (timeouts, 5xx, 429).
 */
export async function generateText(
  cfg: AiConfig,
  keys: ProviderKeys,
  tier: ModelTier,
  req: Omit<TextRequest, "model" | "timeoutMs">,
  fetchImpl: FetchLike = fetch,
): Promise<TextResult> {
  const primaryModel = tier === "fast" ? cfg.fast_model : cfg.strong_model;
  try {
    const primary = createTextProvider(cfg.text_provider, keys, fetchImpl);
    return await primary.generate({ ...req, model: primaryModel, timeoutMs: cfg.timeout_ms });
  } catch (err) {
    const fallbackModel = tier === "fast" ? cfg.fallback_fast_model : cfg.fallback_strong_model;
    const canFallback = err instanceof ProviderError && err.retryable && !req.webSearch &&
      cfg.fallback_provider && cfg.fallback_provider !== cfg.text_provider && fallbackModel;
    if (!canFallback) throw err;
    const fallback = createTextProvider(cfg.fallback_provider!, keys, fetchImpl);
    return await fallback.generate({ ...req, model: fallbackModel!, timeoutMs: cfg.timeout_ms });
  }
}

/** Estimated provider cost in USD: token pricing if configured, else the per-action estimate. */
export function estimateCostUsd(
  cfg: AiConfig,
  model: string,
  inputTokens: number,
  outputTokens: number,
  fallbackEstimate: number,
): number {
  const p = cfg.pricing?.[model];
  if (p && Number.isFinite(p.input_per_mtok) && Number.isFinite(p.output_per_mtok)) {
    return Math.round(((inputTokens * p.input_per_mtok + outputTokens * p.output_per_mtok) / 1e6) * 1e5) / 1e5;
  }
  return fallbackEstimate;
}
