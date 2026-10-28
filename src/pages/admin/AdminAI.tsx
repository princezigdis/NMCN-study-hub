import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, Tabs, Textarea, Toggle, useToast } from "../../components/ui";
import { callFunction, rpc } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { dateTime, naira } from "../../lib/format";
import { Link } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { AiActionCost, AiPlan } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

type Tab = "config" | "test" | "plans" | "costs" | "usage";

export default function AdminAI() {
  const { can } = useAuth();
  const tabs: Array<{ id: Tab; label: string }> = [
    ...(can("ai.manage") ? [{ id: "config" as Tab, label: "Provider & budget" }, { id: "test" as Tab, label: "Test provider" }] : []),
    { id: "plans", label: "Plans & pricing" },
    ...(can("ai.manage") ? [{ id: "costs" as Tab, label: "Credit costs" }, { id: "usage" as Tab, label: "Usage & errors" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  return (
    <div>
      <PageHeader title="AI & plans" subtitle="API keys are stored as server secrets (never here). Change models, budgets, plan allowances and per-action credit costs." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "config" && <ConfigTab />}
      {tab === "test" && <TestTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "costs" && <CostsTab />}
      {tab === "usage" && <UsageTab />}
    </div>
  );
}

interface AiConfig {
  enabled: boolean; text_provider: string; fast_model: string; strong_model: string; fallback_provider: string;
  fallback_fast_model: string; fallback_strong_model: string; image_provider: string; image_model: string; image_size: string;
  daily_budget_usd: number; per_user_per_minute: number; max_input_chars: number; timeout_ms: number; pricing: Record<string, unknown>;
}

function ConfigTab() {
  const toast = useToast();
  const { data, error, loading } = useAsync(async () => (must(await supabase.from("app_settings").select("value").eq("key", "ai.config").single()) as { value: AiConfig }).value, []);
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [pricing, setPricing] = useState("{}");
  useEffect(() => { if (data) { setCfg(data); setPricing(JSON.stringify(data.pricing ?? {}, null, 2)); } }, [data]);
  if (loading || !cfg) return error ? <ErrorBox message={error} /> : <Loading />;
  const set = <K extends keyof AiConfig>(k: K, v: AiConfig[K]) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(pricing || "{}"); } catch { return toast("Pricing must be valid JSON", "error"); }
    const { error } = await supabase.from("app_settings").update({ value: { ...cfg, pricing: parsed } }).eq("key", "ai.config");
    toast(error ? friendly(error) : "AI configuration saved", error ? "error" : "success");
  };

  return (
    <Card className="space-y-5">
      <Toggle checked={cfg.enabled} onChange={(v) => set("enabled", v)} label="AI assistant enabled (global switch)" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Text provider">{(id) => <Select id={id} value={cfg.text_provider} onChange={(e) => set("text_provider", e.target.value)}><option value="anthropic">Anthropic Claude</option><option value="openai">OpenAI</option></Select>}</Field>
        <Field label="Fast model (short tasks)" hint="Summaries, flashcards, mnemonics">{(id) => <Input id={id} value={cfg.fast_model} onChange={(e) => set("fast_model", e.target.value)} />}</Field>
        <Field label="Strong model (deep explanations)" hint="Exam-level, rationales, viva feedback">{(id) => <Input id={id} value={cfg.strong_model} onChange={(e) => set("strong_model", e.target.value)} />}</Field>
        <Field label="Fallback provider" hint="Used only for timeouts / outages">{(id) => <Select id={id} value={cfg.fallback_provider} onChange={(e) => set("fallback_provider", e.target.value)}><option value="">None</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></Select>}</Field>
        <Field label="Fallback fast model">{(id) => <Input id={id} value={cfg.fallback_fast_model} onChange={(e) => set("fallback_fast_model", e.target.value)} placeholder="leave blank to disable" />}</Field>
        <Field label="Fallback strong model">{(id) => <Input id={id} value={cfg.fallback_strong_model} onChange={(e) => set("fallback_strong_model", e.target.value)} placeholder="leave blank to disable" />}</Field>
        <Field label="Image provider">{(id) => <Select id={id} value={cfg.image_provider} onChange={(e) => set("image_provider", e.target.value)}><option value="openai">OpenAI Images</option></Select>}</Field>
        <Field label="Image model">{(id) => <Input id={id} value={cfg.image_model} onChange={(e) => set("image_model", e.target.value)} />}</Field>
        <Field label="Image size">{(id) => <Select id={id} value={cfg.image_size} onChange={(e) => set("image_size", e.target.value)}><option>1024x1024</option><option>1024x1536</option><option>1536x1024</option></Select>}</Field>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Field label="Daily budget cap (USD)" hint="AI pauses for everyone when today's estimate reaches this">{(id) => <Input id={id} type="number" min={0} step={1} value={cfg.daily_budget_usd} onChange={(e) => set("daily_budget_usd", Number(e.target.value))} />}</Field>
        <Field label="Requests / user / minute">{(id) => <Input id={id} type="number" min={1} value={cfg.per_user_per_minute} onChange={(e) => set("per_user_per_minute", Number(e.target.value))} />}</Field>
        <Field label="Max selection length (chars)">{(id) => <Input id={id} type="number" min={500} value={cfg.max_input_chars} onChange={(e) => set("max_input_chars", Number(e.target.value))} />}</Field>
        <Field label="Provider timeout (ms)">{(id) => <Input id={id} type="number" min={5000} step={1000} value={cfg.timeout_ms} onChange={(e) => set("timeout_ms", Number(e.target.value))} />}</Field>
      </div>
      <Field label="Token pricing for cost estimates (optional JSON)" hint={'{"model-id": {"input_per_mtok": 1.0, "output_per_mtok": 5.0}} — USD per million tokens from your provider\'s price list. Without it, each action\'s fixed estimate is used.'}>
        {(id) => <Textarea id={id} rows={5} className="font-mono text-xs" value={pricing} onChange={(e) => setPricing(e.target.value)} />}
      </Field>
      <Button onClick={save}>Save configuration</Button>
      <p className="ink-2 text-xs">Test a new model on the “Test provider” tab before switching to it.</p>
    </Card>
  );
}

function TestTab() {
  const toast = useToast();
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-haiku-5-5");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const secrets = useAsync(() => callFunction<{ secrets: Record<string, boolean> }>("admin-ai-test", {}), []);
  const run = async () => {
    setBusy(true);
    try { setResult(await callFunction("admin-ai-test", { provider, model, prompt })); } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="font-semibold">Server secrets</h2>
        {secrets.loading ? <Loading /> : secrets.error ? <ErrorBox message={secrets.error} /> : (
          <ul className="space-y-1 text-sm">{Object.entries(secrets.data?.secrets ?? {}).map(([k, v]) => (
            <li key={k} className="flex justify-between"><span className="capitalize">{k}</span><Badge tone={v ? "success" : "danger"}>{v ? "configured" : "missing"}</Badge></li>
          ))}</ul>
        )}
        <p className="ink-2 text-xs">Set with <code>supabase secrets set NAME=value</code>. Values are never shown here.</p>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Try a model</h2>
        <div className="grid grid-cols-2 gap-2">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></Select>
          <Input value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model id" />
        </div>
        <Textarea rows={3} placeholder="Optional test prompt (a nursing question)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button onClick={run} loading={busy}>Run test</Button>
        {result && (
          <div className="surface-2 rounded-xl p-3 text-sm">
            <Badge tone={result.ok ? "success" : "danger"}>{result.ok ? "OK" : String(result.error)}</Badge>
            <span className="ink-2 ml-2 text-xs">{String(result.latencyMs)} ms {result.inputTokens !== undefined && `· ${result.inputTokens} in / ${result.outputTokens} out tokens`}</span>
            <p className="mt-2 whitespace-pre-wrap">{String(result.sample ?? result.message ?? "")}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function PlansTab() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(async () => must(await supabase.from("ai_plans").select("*").order("position")) as AiPlan[], []);
  const [rows, setRows] = useState<AiPlan[]>([]);
  useEffect(() => { if (data) setRows(data); }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const set = (i: number, patch: Partial<AiPlan>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async (p: AiPlan) => {
    const { error } = await supabase.from("ai_plans").update({
      name: p.name, monthly_credits: p.monthly_credits, price_kobo: p.price_kobo, period_days: p.period_days, image_limit: p.image_limit,
      web_search_limit: p.web_search_limit, video_search_limit: p.video_search_limit, active: p.active, allowed_actions: p.allowed_actions,
    }).eq("code", p.code);
    toast(error ? friendly(error) : `${p.name} saved`, error ? "error" : "success");
    if (!error) reload();
  };
  return (
    <Card className="overflow-x-auto p-0 sm:p-0">
      <table className="w-full text-sm">
        <thead className="surface-2 ink-2 text-left text-xs uppercase"><tr><th className="p-3">Plan</th><th>Credits / period</th><th>Price (₦)</th><th>Days</th><th>Diagrams</th><th>Web</th><th>Video</th><th>Allowed actions</th><th>Active</th><th /></tr></thead>
        <tbody>{rows.map((p, i) => (
          <tr key={p.code} className="border-t line">
            <td className="p-2"><Input value={p.name} onChange={(e) => set(i, { name: e.target.value })} className="w-28" /></td>
            <td><Input type="number" min={0} value={p.monthly_credits} onChange={(e) => set(i, { monthly_credits: Number(e.target.value) })} className="w-24" /></td>
            <td><Input type="number" min={0} value={p.price_kobo / 100} onChange={(e) => set(i, { price_kobo: Math.round(Number(e.target.value) * 100) })} className="w-24" disabled={p.code === "free"} /></td>
            <td><Input type="number" min={1} value={p.period_days} onChange={(e) => set(i, { period_days: Number(e.target.value) })} className="w-16" /></td>
            <td><Input type="number" min={0} value={p.image_limit} onChange={(e) => set(i, { image_limit: Number(e.target.value) })} className="w-16" /></td>
            <td><Input type="number" min={0} value={p.web_search_limit} onChange={(e) => set(i, { web_search_limit: Number(e.target.value) })} className="w-16" /></td>
            <td><Input type="number" min={0} value={p.video_search_limit} onChange={(e) => set(i, { video_search_limit: Number(e.target.value) })} className="w-16" /></td>
            <td><Input value={p.allowed_actions.join(",")} onChange={(e) => set(i, { allowed_actions: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="w-40" title="* = all actions" /></td>
            <td><input type="checkbox" checked={p.active} onChange={(e) => set(i, { active: e.target.checked })} aria-label="Active" disabled={p.code === "free"} /></td>
            <td className="pr-2"><Button size="sm" onClick={() => save(p)}>Save</Button></td>
          </tr>
        ))}</tbody>
      </table>
      <p className="ink-2 p-3 text-xs">Shown to students as {rows.map((p) => `${p.name} ${p.price_kobo ? naira(p.price_kobo) : "free"}`).join(" · ")}. Changes apply from each user's next period (or next purchase).</p>
    </Card>
  );
}

function CostsTab() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(async () => must(await supabase.from("ai_action_costs").select("*").order("credits")) as AiActionCost[], []);
  const [rows, setRows] = useState<AiActionCost[]>([]);
  useEffect(() => { if (data) setRows(data); }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const set = (i: number, patch: Partial<AiActionCost>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async (c: AiActionCost) => {
    const { error } = await supabase.from("ai_action_costs").update({ label: c.label, credits: c.credits, max_output_tokens: c.max_output_tokens, est_provider_cost_usd: c.est_provider_cost_usd, enabled: c.enabled }).eq("action", c.action);
    toast(error ? friendly(error) : "Saved", error ? "error" : "success");
    if (!error) reload();
  };
  return (
    <Card className="overflow-x-auto p-0 sm:p-0">
      <table className="w-full text-sm">
        <thead className="surface-2 ink-2 text-left text-xs uppercase"><tr><th className="p-3">Action</th><th>Label</th><th>Tier</th><th>Credits</th><th>Max output tokens</th><th>Est. cost (USD)</th><th>On</th><th /></tr></thead>
        <tbody>{rows.map((c, i) => (
          <tr key={c.action} className="border-t line">
            <td className="p-2 font-mono text-xs">{c.action}</td>
            <td><Input value={c.label} onChange={(e) => set(i, { label: e.target.value })} className="w-48" /></td>
            <td><Badge>{c.tier}</Badge></td>
            <td><Input type="number" min={1} value={c.credits} onChange={(e) => set(i, { credits: Number(e.target.value) })} className="w-20" /></td>
            <td><Input type="number" min={50} max={8000} value={c.max_output_tokens} onChange={(e) => set(i, { max_output_tokens: Number(e.target.value) })} className="w-24" /></td>
            <td><Input type="number" min={0} step={0.001} value={c.est_provider_cost_usd} onChange={(e) => set(i, { est_provider_cost_usd: Number(e.target.value) })} className="w-24" /></td>
            <td><input type="checkbox" checked={c.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} aria-label="Enabled" /></td>
            <td className="pr-2"><Button size="sm" onClick={() => save(c)}>Save</Button></td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function UsageTab() {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useAsync(() => rpc<{
    by_day: Array<{ day: string; requests: number; failures: number; credits: number; cost_usd: number }>;
    by_action: Array<{ action: string; requests: number; failures: number; credits: number; cost_usd: number; avg_latency_ms: number }>;
    recent_errors: Array<{ id: string; action: string; error: string; model: string; created_at: string }>;
  }>("admin_ai_usage", { p_days: days }), [days]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} />;
  const max = Math.max(1, ...data.by_day.map((d) => d.requests));
  return (
    <div className="space-y-4">
      <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40" aria-label="Period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>
      <Card>
        <h2 className="mb-3 font-semibold">Requests per day</h2>
        <div className="flex h-40 gap-1" role="img" aria-label="AI requests per day">
          {data.by_day.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col justify-end" title={`${d.day}: ${d.requests} requests, ${d.failures} failed, $${d.cost_usd}`}>
              <div className="rounded-t bg-red-400" style={{ height: `${(d.failures / max) * 100}%` }} />
              <div className="bg-brand-500" style={{ height: `${((d.requests - d.failures) / max) * 100}%` }} />
            </div>
          ))}
        </div>
      </Card>
      <Card className="overflow-x-auto">
        <h2 className="mb-3 font-semibold">By action</h2>
        <table className="w-full text-sm">
          <thead className="ink-2 text-left text-xs uppercase"><tr><th className="py-1">Action</th><th>Requests</th><th>Failed</th><th>Credits</th><th>Est. cost</th><th>Avg latency</th></tr></thead>
          <tbody>{data.by_action.map((a) => <tr key={a.action} className="border-t line"><td className="py-1.5 font-mono text-xs">{a.action}</td><td>{a.requests}</td><td>{a.failures}</td><td>{a.credits}</td><td>${Number(a.cost_usd).toFixed(3)}</td><td>{a.avg_latency_ms ?? "—"} ms</td></tr>)}</tbody>
        </table>
      </Card>
      <Card>
        <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Recent failures (refunded)</h2><Link to="/admin/reports?type=ai_response" className="text-sm underline">AI error reports from students</Link></div>
        <ul className="space-y-1 text-sm">{data.recent_errors.map((e) => <li key={e.id} className="flex gap-2"><span className="font-mono text-xs">{e.action}</span><Badge tone="danger">{e.error}</Badge><span className="ink-2 text-xs">{e.model} · {dateTime(e.created_at)}</span></li>)}</ul>
      </Card>
    </div>
  );
}
