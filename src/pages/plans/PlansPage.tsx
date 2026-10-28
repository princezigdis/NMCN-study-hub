import { useState } from "react";
import { useAI } from "../../components/ai/AIContext";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, cx, ErrorBox, Loading, PageHeader, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { dateShort, naira } from "../../lib/format";
import { Link } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { AiActionCost, AiPlan } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

export default function PlansPage() {
  const toast = useToast();
  const { wallet } = useAI();
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [plans, costs] = await Promise.all([
      supabase.from("ai_plans").select("*").eq("active", true).order("position"),
      supabase.from("ai_action_costs").select("*").eq("enabled", true).order("credits"),
    ]);
    if (plans.error) throw plans.error;
    return { plans: plans.data as AiPlan[], costs: (costs.data ?? []) as AiActionCost[] };
  }, []);

  const buy = async (code: string) => {
    setBusy(code);
    try {
      const { authorizationUrl } = await api.checkout("ai_plan", code);
      window.location.assign(authorizationUrl);
    } catch (e) {
      toast(friendly(e), "error");
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load plans"} onRetry={reload} />;
  const free = data.plans.find((p) => p.code === "free");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="AI study plans" subtitle="Everyone gets free monthly credits. Upgrade for more explanations, diagrams and video searches." />
      {wallet && (
        <Card className="mb-6 flex flex-wrap items-center gap-4">
          <div className="text-3xl font-bold">{wallet.balance}</div>
          <div className="ink-2 text-sm">credits left on your <b>{wallet.plan_name}</b> plan · renews {dateShort(wallet.period_end)}</div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((p) => {
          const current = wallet?.plan_code === p.code;
          const mult = free && free.monthly_credits ? Math.round(p.monthly_credits / free.monthly_credits) : null;
          return (
            <Card key={p.code} className={cx("flex flex-col", p.code === "pro" && "border-2 border-brand-500")}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{p.name}</h2>
                {p.code === "pro" && <Badge tone="brand">Popular</Badge>}
                {current && <Badge tone="success">Current</Badge>}
              </div>
              <div className="mt-2 text-2xl font-bold">{p.price_kobo ? naira(p.price_kobo) : "Free"}</div>
              <div className="ink-2 text-xs">{p.price_kobo ? `per ${p.period_days} days` : "every month"}</div>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                <li className="flex gap-2"><Icon name="sparkles" size={16} className="shrink-0 text-accent-500" /><span><b>{p.monthly_credits.toLocaleString()}</b> credits{mult && mult > 1 ? ` (${mult}× Free)` : ""}</span></li>
                <li className="flex gap-2"><Icon name="image" size={16} className="shrink-0 text-brand-600" />{p.image_limit} diagrams</li>
                <li className="flex gap-2"><Icon name="video" size={16} className="shrink-0 text-brand-600" />{p.video_search_limit} video searches</li>
                <li className="flex gap-2"><Icon name="search" size={16} className="shrink-0 text-brand-600" />{p.web_search_limit} web searches</li>
              </ul>
              {p.price_kobo > 0 && (
                <Button className="mt-4 w-full" variant={p.code === "pro" ? "primary" : "secondary"} onClick={() => buy(p.code)} loading={busy === p.code}>
                  {current ? "Renew / top up" : `Get ${p.name}`}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      <p className="ink-2 mt-3 text-xs">Credits refresh each period and don't roll over (except remaining credits carried once when you upgrade). Failed AI requests are refunded automatically. AI plans are separate from Section C/D exam access.</p>

      <Card className="mt-8">
        <h2 className="mb-3 font-semibold">What each AI tool costs</h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {data.costs.map((c) => (
            <div key={c.action} className="flex justify-between border-b line py-1.5 text-sm"><span>{c.label}</span><span className="font-semibold">{c.credits} credit{c.credits > 1 ? "s" : ""}</span></div>
          ))}
        </div>
      </Card>
      <p className="ink-2 mt-6 text-center text-sm">Looking for the exams? <Link to="/mock" className="underline">Section C</Link> and <Link to="/final" className="underline">Section D</Link> are unlocked separately.</p>
    </div>
  );
}
