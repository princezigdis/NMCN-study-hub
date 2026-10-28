import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, Select, StatusBadge, Tabs, useToast } from "../../components/ui";
import { api, rpc } from "../../lib/api";
import { downloadText, toCsv } from "../../lib/csv";
import { friendly } from "../../lib/errors";
import { dateTime, naira } from "../../lib/format";
import { Link, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Product } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

type Tab = "transactions" | "events" | "refunds" | "products";

export default function AdminPayments() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "transactions";
  return (
    <div>
      <PageHeader title="Payments" subtitle="Paystack transactions are verified on the server before access is granted. Complimentary grants are recorded separately under Users." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { id: "transactions", label: "Transactions" }, { id: "events", label: "Webhook events" }, { id: "refunds", label: "Refunds" }, { id: "products", label: "Exam prices" },
      ]} />
      {tab === "transactions" && <Transactions />}
      {tab === "events" && <Events />}
      {tab === "refunds" && <Refunds />}
      {tab === "products" && <Products />}
    </div>
  );
}

interface Payment { id: string; user_id: string; reference: string; purpose: string; item_code: string; amount_kobo: number; status: string; mode: string; channel: string | null; created_at: string; paid_at: string | null; profiles: { email: string | null } | null }

function Transactions() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [ref, setRef] = useState("");
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from("payments").select("*, profiles(email)").order("created_at", { ascending: false }).limit(200);
    if (status) q = q.eq("status", status);
    if (ref.trim()) q = q.ilike("reference", `%${ref.trim()}%`);
    return must(await q) as unknown as Payment[];
  }, [status, ref]);

  const total = (data ?? []).filter((p) => p.status === "success").reduce((s, p) => s + p.amount_kobo, 0);
  const reverify = async (reference: string) => {
    try { const r = await api.verifyPayment(reference); toast(`Status: ${r.status}`); reload(); } catch (e) { toast(friendly(e), "error"); }
  };
  const refund = async (p: Payment) => {
    const reason = window.prompt(`Record a refund for ${p.reference}? First refund the customer in your Paystack dashboard. Reason:`);
    if (!reason) return;
    try { await rpc("admin_record_refund", { p_payment: p.id, p_reason: reason }); toast("Refund recorded and access removed"); reload(); } catch (e) { toast(friendly(e), "error"); }
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2">
        <Input placeholder="Reference…" value={ref} onChange={(e) => setRef(e.target.value)} className="w-56" aria-label="Reference" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status">
          <option value="">All statuses</option>{["initialized", "success", "failed", "abandoned", "refunded", "amount_mismatch"].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <span className="text-sm">Successful in view: <b>{naira(total)}</b></span>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" icon="download" onClick={() => downloadText("payments.csv", toCsv(["reference", "item_code", "amount_kobo", "status", "mode", "channel", "created_at", "paid_at"], (data ?? []) as unknown as Array<Record<string, unknown>>))}>Export</Button>
      </Card>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full text-sm">
          <thead className="surface-2 ink-2 text-left text-xs uppercase"><tr><th className="p-3">Reference</th><th>Customer</th><th>Item</th><th>Amount</th><th>Status</th><th>Mode</th><th>Created</th><th /></tr></thead>
          <tbody>{data?.map((p) => (
            <tr key={p.id} className="border-t line">
              <td className="p-3 font-mono text-xs">{p.reference}</td>
              <td><Link to={`/admin/users/${p.user_id}`} className="underline">{p.profiles?.email ?? "user"}</Link></td>
              <td>{p.item_code}</td><td>{naira(p.amount_kobo)}</td><td><StatusBadge status={p.status} /></td>
              <td><Badge tone={p.mode === "live" ? "success" : "warning"}>{p.mode}</Badge></td><td className="ink-2 text-xs">{dateTime(p.created_at)}</td>
              <td className="space-x-2 pr-2 text-right text-xs">
                {p.status === "initialized" && can("payments.manage") && <button className="underline" onClick={() => reverify(p.reference)}>Re-verify</button>}
                {p.status === "success" && can("payments.manage") && <button className="text-red-600 underline" onClick={() => refund(p)}>Record refund</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function Events() {
  const { data, error, loading } = useAsync(async () => must(await supabase.from("payment_events").select("id, event_type, reference, signature_valid, processed, processing_error, received_at").order("received_at", { ascending: false }).limit(200)) as Array<{ id: number; event_type: string | null; reference: string | null; signature_valid: boolean; processed: boolean; processing_error: string | null; received_at: string }>, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <Card className="overflow-x-auto p-0 sm:p-0">
      <table className="w-full text-sm">
        <thead className="surface-2 ink-2 text-left text-xs uppercase"><tr><th className="p-3">Received</th><th>Event</th><th>Reference</th><th>Processed</th><th>Error</th></tr></thead>
        <tbody>{data?.map((e) => (
          <tr key={e.id} className="border-t line"><td className="p-3 text-xs">{dateTime(e.received_at)}</td><td>{e.event_type}</td><td className="font-mono text-xs">{e.reference}</td>
            <td><Badge tone={e.processed ? "success" : "danger"}>{e.processed ? "yes" : "no"}</Badge></td><td className="text-xs text-red-600">{e.processing_error}</td></tr>
        ))}</tbody>
      </table>
      <p className="ink-2 p-3 text-xs">Duplicate deliveries are ignored automatically. Unprocessed events can be fixed by re-verifying the transaction.</p>
    </Card>
  );
}

function Refunds() {
  const { data, error, loading } = useAsync(async () => must(await supabase.from("refunds").select("*, payments(reference, item_code)").order("created_at", { ascending: false })) as unknown as Array<{ id: string; amount_kobo: number; reason: string; status: string; created_at: string; payments: { reference: string; item_code: string } | null }>, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <Card>
      {!data?.length ? <p className="ink-2 text-sm">No refunds recorded.</p> : (
        <table className="w-full text-sm"><tbody>{data.map((r) => (
          <tr key={r.id} className="border-t line"><td className="py-2 font-mono text-xs">{r.payments?.reference}</td><td>{r.payments?.item_code}</td><td>{naira(r.amount_kobo)}</td><td>{r.reason}</td><td className="ink-2 text-xs">{dateTime(r.created_at)}</td></tr>
        ))}</tbody></table>
      )}
    </Card>
  );
}

function Products() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(async () => must(await supabase.from("products").select("*").order("code")) as Product[], []);
  const [rows, setRows] = useState<Product[]>([]);
  useEffect(() => { if (data) setRows(data); }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const set = (i: number, patch: Partial<Product>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async (p: Product) => {
    const { error } = await supabase.from("products").update({ name: p.name, description: p.description, price_kobo: p.price_kobo, access_days: p.access_days, active: p.active }).eq("code", p.code);
    toast(error ? friendly(error) : "Saved", error ? "error" : "success");
    if (!error) reload();
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {rows.map((p, i) => (
        <Card key={p.code} className="space-y-3">
          <div className="flex items-center gap-2"><Badge tone="brand">{p.code}</Badge>{!p.active && <Badge tone="danger">not on sale</Badge>}</div>
          <Input value={p.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Name" disabled={!can("pricing.manage")} />
          <Input value={p.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" disabled={!can("pricing.manage")} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Price (₦)<Input type="number" min={0} value={p.price_kobo / 100} onChange={(e) => set(i, { price_kobo: Math.round(Number(e.target.value) * 100) })} disabled={!can("pricing.manage")} /></label>
            <label className="text-sm">Access days (blank = no expiry)<Input type="number" min={1} value={p.access_days ?? ""} onChange={(e) => set(i, { access_days: e.target.value ? Number(e.target.value) : null })} disabled={!can("pricing.manage")} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.active} onChange={(e) => set(i, { active: e.target.checked })} disabled={!can("pricing.manage")} />On sale</label>
          {can("pricing.manage") && <Button size="sm" onClick={() => save(p)}>Save</Button>}
          <p className="ink-2 text-xs">Price changes apply to new checkouts only. Existing access is unaffected.</p>
        </Card>
      ))}
    </div>
  );
}
