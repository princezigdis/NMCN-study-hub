// POST /functions/v1/payments-initialize  { purpose: "product"|"ai_plan", code: "section_c"|"standard"|... }
// Prices come from the database, never from the browser.
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, env, getSetting, requireUser } from "../_shared/supabase.ts";
import { initializeTransaction, keyMode, makeReference, PaymentError } from "../_shared/paystack.ts";

Deno.serve(handler(Deno.env.get("ALLOWED_ORIGINS") ?? "*", async (req) => {
  const { user } = await requireUser(req);
  const admin = adminClient();
  const body = await readJson<{ purpose?: string; code?: string }>(req, 4096);
  const purpose = body.purpose === "ai_plan" ? "ai_plan" : body.purpose === "product" ? "product" : null;
  const code = String(body.code ?? "");
  if (!purpose || !/^[a-z_]{2,30}$/.test(code)) throw new HttpError(400, "invalid_item");

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  const mode = keyMode(secret);
  if (!mode) throw new HttpError(503, "payments_not_configured", "Payments are not set up yet.");
  const cfg = (await getSetting<{ mode?: string; callback_path?: string }>(admin, "payments.config")) ?? {};
  if ((cfg.mode ?? "test") !== mode) {
    // Prevents accidentally charging real cards while the app is configured for testing (or vice versa).
    throw new HttpError(503, "payment_mode_mismatch", "Payment configuration mismatch. Contact support.");
  }

  const appUrl = env("APP_URL").replace(/\/$/, "");   // fail early if not configured
  const { data: profile } = await admin.from("profiles").select("status").eq("id", user.id).single();
  if (profile?.status !== "active") throw new HttpError(403, "account_suspended");

  let amountKobo = 0;
  let label = "";
  if (purpose === "product") {
    const { data: p } = await admin.from("products").select("name, price_kobo, active").eq("code", code).maybeSingle();
    if (!p?.active || p.price_kobo <= 0) throw new HttpError(404, "item_unavailable");
    const { data: hasAccess } = await admin.rpc("user_has_entitlement", { p_user: user.id, p_product: code });
    if (hasAccess) throw new HttpError(409, "already_has_access", "You already have access to this section.");
    amountKobo = p.price_kobo; label = p.name;
  } else {
    const { data: plan } = await admin.from("ai_plans").select("name, price_kobo, active").eq("code", code).maybeSingle();
    if (!plan?.active || plan.price_kobo <= 0) throw new HttpError(404, "item_unavailable");
    amountKobo = plan.price_kobo; label = `${plan.name} AI plan`;
  }

  // Throttle abandoned checkouts: at most 5 open initialisations per user per hour.
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("status", "initialized").gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 5) throw new HttpError(429, "too_many_checkouts", "Too many unfinished checkouts. Try again later.");

  const reference = makeReference(purpose);
  const { data: payment, error } = await admin.from("payments").insert({
    user_id: user.id, reference, purpose, item_code: code, amount_kobo: amountKobo, currency: "NGN", mode,
    metadata: { label },
  }).select("id").single();
  if (error || !payment) throw new HttpError(500, "payment_record_failed");

  try {
    const { authorizationUrl } = await initializeTransaction(secret, {
      email: user.email ?? "",
      amountKobo,
      reference,
      callbackUrl: `${appUrl}${cfg.callback_path ?? "/payment/callback"}?reference=${encodeURIComponent(reference)}`,
      metadata: { payment_id: payment.id, purpose, item_code: code },
    });
    return json({ authorizationUrl, reference, amountKobo, mode });
  } catch (err) {
    await admin.from("payments").update({ status: "failed", metadata: { label, init_error: (err as Error).message } }).eq("id", payment.id);
    if (err instanceof PaymentError) throw new HttpError(502, err.code, "Could not start the payment. Please try again.");
    throw err;
  }
}));
