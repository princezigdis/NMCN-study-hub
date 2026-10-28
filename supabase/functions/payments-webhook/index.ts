// POST /functions/v1/payments-webhook   (Paystack -> us; JWT verification disabled in config.toml)
// 1. Verify the HMAC-SHA512 signature over the RAW body.
// 2. Store the event once (sha256 of body = dedupe key) so retries are harmless.
// 3. Re-verify the transaction with Paystack's API before fulfilling.
import { json } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { sanitizeTransaction, sha256Hex, verifyTransaction, verifyWebhookSignature } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  if (!secret) return json({ error: "not_configured" }, 503);

  const raw = await req.text();
  if (raw.length > 256 * 1024) return json({ error: "payload_too_large" }, 413);
  const valid = await verifyWebhookSignature(raw, req.headers.get("x-paystack-signature"), secret);
  if (!valid) return json({ error: "invalid_signature" }, 401);

  let event: { event?: string; data?: { reference?: string } };
  try { event = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  const admin = adminClient();
  const eventKey = await sha256Hex(raw);
  const reference = event.data?.reference ?? null;

  const { data: inserted, error: insErr } = await admin.from("payment_events").insert({
    provider: "paystack", event_key: eventKey, event_type: event.event ?? null, reference,
    signature_valid: true, payload: event,
  }).select("id").maybeSingle();
  if (insErr) {
    // Unique violation => we've already received this exact event: acknowledge.
    if (insErr.code === "23505") return json({ received: true, duplicate: true });
    console.error("webhook_store_failed", insErr.message);
    return json({ error: "store_failed" }, 500); // Paystack will retry
  }

  let processingError: string | null = null;
  try {
    if (event.event === "charge.success" && reference) {
      const tx = await verifyTransaction(secret, reference);
      if (tx.status === "success") {
        const { data, error } = await admin.rpc("payment_fulfill", {
          p_reference: reference, p_amount_kobo: tx.amount, p_currency: tx.currency,
          p_provider_txn: String(tx.id), p_channel: tx.channel ?? null, p_paid_at: tx.paid_at ?? null,
          p_raw: sanitizeTransaction(tx),
        });
        if (error) throw new Error(error.message);
        const res = data as { ok: boolean; error?: string };
        if (!res.ok) processingError = res.error ?? "fulfil_failed";
      } else {
        processingError = `verify_status_${tx.status}`;
      }
    }
  } catch (err) {
    processingError = (err as Error).message.slice(0, 300);
  }

  await admin.from("payment_events").update({
    processed: processingError === null, processing_error: processingError, processed_at: new Date().toISOString(),
  }).eq("id", inserted!.id);

  // Always 200 once stored; failures are visible in Admin → Payments → Webhook events and can be re-verified.
  return json({ received: true });
});
