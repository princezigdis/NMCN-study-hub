// POST /functions/v1/payments-verify  { reference }
// Called by the payment callback page (and by finance staff to reconcile). Asks Paystack directly whether the
// transaction succeeded, then fulfils it idempotently (same path as the webhook).
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { PaymentError, sanitizeTransaction, verifyTransaction } from "../_shared/paystack.ts";

Deno.serve(handler(Deno.env.get("ALLOWED_ORIGINS") ?? "*", async (req) => {
  const { user, userClient } = await requireUser(req);
  const admin = adminClient();
  const { reference } = await readJson<{ reference?: string }>(req, 2048);
  if (typeof reference !== "string" || !/^NMCN-[A-Z]{2}-[A-Z0-9]+-[A-F0-9]{16}$/.test(reference)) {
    throw new HttpError(400, "invalid_reference");
  }

  const { data: payment } = await admin.from("payments").select("id, user_id, status, purpose, item_code")
    .eq("reference", reference).maybeSingle();
  if (!payment) throw new HttpError(404, "payment_not_found");
  if (payment.user_id !== user.id) {
    // Finance staff may re-verify any payment for reconciliation.
    const { data: canManage } = await userClient.rpc("has_permission", { perm: "payments.manage" });
    if (!canManage) throw new HttpError(404, "payment_not_found");
  }
  if (payment.status === "success") return json({ status: "success", purpose: payment.purpose, item: payment.item_code });
  if (payment.status !== "initialized") return json({ status: payment.status, purpose: payment.purpose, item: payment.item_code });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  if (!secret) throw new HttpError(503, "payments_not_configured");

  try {
    const tx = await verifyTransaction(secret, reference);
    if (tx.status === "success") {
      const { data: result, error } = await admin.rpc("payment_fulfill", {
        p_reference: reference, p_amount_kobo: tx.amount, p_currency: tx.currency,
        p_provider_txn: String(tx.id), p_channel: tx.channel ?? null, p_paid_at: tx.paid_at ?? null,
        p_raw: sanitizeTransaction(tx),
      });
      if (error) throw new HttpError(500, "fulfilment_failed");
      const res = result as { ok: boolean; error?: string };
      if (!res.ok) return json({ status: res.error ?? "failed", purpose: payment.purpose, item: payment.item_code });
      return json({ status: "success", purpose: payment.purpose, item: payment.item_code });
    }
    if (tx.status === "failed" || tx.status === "abandoned") {
      await admin.rpc("payment_mark", { p_reference: reference, p_status: tx.status, p_raw: sanitizeTransaction(tx) });
      return json({ status: tx.status, purpose: payment.purpose, item: payment.item_code });
    }
    return json({ status: "pending", purpose: payment.purpose, item: payment.item_code });
  } catch (err) {
    if (err instanceof PaymentError) throw new HttpError(502, err.code, "Could not confirm the payment yet. Please retry in a moment.");
    throw err;
  }
}));
