import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { keyMode, makeReference, safeEqual, sanitizeTransaction, sha256Hex, verifyWebhookSignature } from "../supabase/functions/_shared/paystack.ts";
import { matchPath } from "../src/lib/matchPath.ts";
import { toAppError } from "../src/lib/errors.ts";

const SECRET = "sk_test_dummy_for_unit_tests";

test("valid Paystack webhook signatures are accepted; tampered bodies are rejected", async () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "NMCN-EX-ABC-0011223344556677", amount: 150000 } });
  const sig = createHmac("sha512", SECRET).update(body).digest("hex");
  assert.equal(await verifyWebhookSignature(body, sig, SECRET), true);
  assert.equal(await verifyWebhookSignature(body.replace("150000", "1"), sig, SECRET), false);
  assert.equal(await verifyWebhookSignature(body, null, SECRET), false);
  assert.equal(await verifyWebhookSignature(body, sig, "sk_test_other"), false);
});

test("duplicate webhook deliveries produce the same dedupe key", async () => {
  const a = await sha256Hex('{"event":"charge.success"}');
  assert.equal(a, await sha256Hex('{"event":"charge.success"}'));
  assert.equal(a.length, 64);
});

test("key mode detection prevents mixing test and live", () => {
  assert.equal(keyMode("sk_test_x"), "test");
  assert.equal(keyMode("sk_live_x"), "live");
  assert.equal(keyMode("pk_live_x"), null);
});

test("references are unique and match the server-side verification pattern", () => {
  const pattern = /^NMCN-[A-Z]{2}-[A-Z0-9]+-[A-F0-9]{16}$/;
  const refs = new Set(Array.from({ length: 50 }, () => makeReference("product")));
  assert.equal(refs.size, 50);
  for (const r of refs) assert.match(r, pattern);
  assert.match(makeReference("ai_plan"), /^NMCN-AI-/);
});

test("only non-sensitive transaction fields are stored", () => {
  const t = sanitizeTransaction({ status: "success", reference: "r", amount: 1, currency: "NGN", id: 9,
    channel: "card", paid_at: null, gateway_response: "Approved", ...({ authorization: { last4: "4081", bin: "408408" }, customer: { email: "x@y" } } as object) } as never);
  assert.equal("authorization" in t, false);
  assert.equal("customer" in t, false);
  assert.equal(t.status, "success");
});

test("safeEqual compares strings exactly", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "ab"));
});

test("route matching extracts params and supports wildcards", () => {
  assert.deepEqual(matchPath("/library/note/:id", "/library/note/123"), { id: "123" });
  assert.equal(matchPath("/library/note/:id", "/library/note"), null);
  assert.deepEqual(matchPath("/exam/:id/review", "/exam/a%20b/review/"), { id: "a b" });
  assert.deepEqual(matchPath("/admin/*", "/admin/questions/7"), { "*": "questions/7" });
  assert.equal(matchPath("/", "/x"), null);
});

test("database error codes become friendly messages", () => {
  assert.match(toAppError({ message: "payment_required:section_c" }).message, /unlocked/);
  assert.equal(toAppError({ message: "payment_required:section_c" }).code, "payment_required");
  assert.match(toAppError({ message: "question_invalid: needs exactly one correct option (has 2)" }).message, /exactly one correct/);
  assert.match(toAppError(new Error("Failed to fetch")).message, /offline/);
});
