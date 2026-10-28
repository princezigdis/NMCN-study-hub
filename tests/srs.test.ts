import { test } from "node:test";
import assert from "node:assert/strict";
import { review } from "../src/lib/srs.ts";

const fresh = { ease: 2.5, interval_days: 0, repetitions: 0 };
const now = new Date("2026-01-01T08:00:00Z");

test("first successful reviews schedule 1 day then 3 days", () => {
  const r1 = review(fresh, 4, now);
  assert.equal(r1.interval_days, 1);
  const r2 = review(r1, 4, now);
  assert.equal(r2.interval_days, 3);
  const r3 = review(r2, 4, now);
  assert.ok(r3.interval_days >= 7, `third interval grows (got ${r3.interval_days})`);
});

test("forgetting resets the card to relearn in 10 minutes", () => {
  const learned = { ease: 2.5, interval_days: 20, repetitions: 5 };
  const r = review(learned, 0, now);
  assert.equal(r.repetitions, 0);
  assert.equal(r.interval_days, 0);
  assert.equal(r.due_at.getTime() - now.getTime(), 10 * 60 * 1000);
});

test("ease never drops below 1.3 and intervals are capped at a year", () => {
  let s = { ease: 1.35, interval_days: 300, repetitions: 9 };
  for (let i = 0; i < 5; i++) s = review(s, 3, now);
  assert.ok(s.ease >= 1.3);
  assert.ok(s.interval_days <= 365);
});

test("easy grows faster than hard", () => {
  const base = { ease: 2.5, interval_days: 10, repetitions: 3 };
  assert.ok(review(base, 5, now).interval_days > review(base, 3, now).interval_days);
});
