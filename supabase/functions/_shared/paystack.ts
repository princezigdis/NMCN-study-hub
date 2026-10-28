// Paystack integration helpers (https://paystack.com/docs/api/).
// Amounts are always in kobo. Only the server ever sees the secret key.
import { type FetchLike, fetchWithTimeout } from "./ai/types.ts";

const BASE = "https://api.paystack.co";

export class PaymentError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
  }
}

export function keyMode(secretKey: string): "test" | "live" | null {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return null;
}

/** Unique, unguessable transaction reference. */
export function makeReference(purpose: "product" | "ai_plan"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `NMCN-${purpose === "product" ? "EX" : "AI"}-${Date.now().toString(36).toUpperCase()}-${rand.toUpperCase()}`;
}

export interface InitializeArgs {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export async function initializeTransaction(
  secretKey: string,
  args: InitializeArgs,
  fetchImpl: FetchLike = fetch,
): Promise<{ authorizationUrl: string; accessCode: string }> {
  const res = await fetchWithTimeout(fetchImpl, `${BASE}/transaction/initialize`, {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: args.email,
      amount: args.amountKobo,
      currency: "NGN",
      reference: args.reference,
      callback_url: args.callbackUrl,
      metadata: args.metadata,
    }),
  }, 15000);
  const json = await res.json().catch(() => ({})) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; access_code?: string };
  };
  if (!res.ok || !json.status || !json.data?.authorization_url) {
    throw new PaymentError("paystack_initialize_failed", json.message ?? `Paystack error ${res.status}`);
  }
  return { authorizationUrl: json.data.authorization_url, accessCode: json.data.access_code ?? "" };
}

export interface VerifiedTransaction {
  status: string;          // success | failed | abandoned | ongoing | pending ...
  reference: string;
  amount: number;          // kobo
  currency: string;
  id: number | string;
  channel?: string;
  paid_at?: string | null;
  gateway_response?: string;
}

export async function verifyTransaction(
  secretKey: string,
  reference: string,
  fetchImpl: FetchLike = fetch,
): Promise<VerifiedTransaction> {
  const res = await fetchWithTimeout(fetchImpl, `${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { authorization: `Bearer ${secretKey}` },
  }, 15000);
  const json = await res.json().catch(() => ({})) as { status?: boolean; message?: string; data?: VerifiedTransaction };
  if (!res.ok || !json.status || !json.data) {
    throw new PaymentError("paystack_verify_failed", json.message ?? `Paystack error ${res.status}`);
  }
  return json.data;
}

/** Keep only non-sensitive fields from a verification payload for storage. */
export function sanitizeTransaction(t: VerifiedTransaction): Record<string, unknown> {
  return {
    status: t.status, reference: t.reference, amount: t.amount, currency: t.currency, id: t.id,
    channel: t.channel ?? null, paid_at: t.paid_at ?? null, gateway_response: t.gateway_response ?? null,
  };
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Paystack signs webhooks with HMAC-SHA512(raw body, secret key) in `x-paystack-signature`. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null, secretKey: string): Promise<boolean> {
  if (!signature || !secretKey) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return safeEqual(toHex(mac), signature.trim().toLowerCase());
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
