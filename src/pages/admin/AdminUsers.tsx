import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, StatusBadge, useConfirm, useToast } from "../../components/ui";
import { callFunction, rpc } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { dateShort, dateTime, naira, PRODUCT_LABEL } from "../../lib/format";
import { Link, useParams, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { AppRole } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { type FieldDef, FormModal, must } from "./adminKit";

const ROLES: AppRole[] = ["super_admin", "content_admin", "question_admin", "reviewer", "exam_admin", "support", "finance"];

export default function AdminUsers() {
  const { id } = useParams<{ id?: string }>();
  return id ? <UserDetail id={id} /> : <UserList />;
}

function UserList() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const { programmes } = useAuth();
  const term = params.get("q") ?? "";
  const prog = params.get("programme") ?? "";
  const status = params.get("status") ?? "";
  const { data, error, loading } = useAsync(async () => {
    let query = supabase.from("profiles").select("id, email, full_name, programme_id, status, created_at, last_active_at").order("created_at", { ascending: false }).limit(100);
    if (term) {
      const t = term.replace(/[%_,()]/g, "");
      query = query.or(`email.ilike.%${t}%,full_name.ilike.%${t}%`);
    }
    if (prog) query = query.eq("programme_id", prog);
    if (status) query = query.eq("status", status);
    return must(await query) as Array<{ id: string; email: string | null; full_name: string | null; programme_id: string | null; status: string; created_at: string; last_active_at: string | null }>;
  }, [term, prog, status]);

  return (
    <div>
      <PageHeader title="Users & access" subtitle="Search students, manage access, roles and credits. Passwords are never visible to admins." />
      <Card className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <form className="sm:col-span-2" onSubmit={(e) => { e.preventDefault(); setParams({ q: q.trim() || null }); }}>
          <Input placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </form>
        <Select value={prog} onChange={(e) => setParams({ programme: e.target.value || null })} aria-label="Programme"><option value="">All programmes</option>{programmes.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select>
        <Select value={status} onChange={(e) => setParams({ status: e.target.value || null })} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></Select>
      </Card>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && !data.length && <EmptyState icon="user" title="No users found" />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full text-sm">
            <thead className="surface-2 ink-2 text-left text-xs uppercase"><tr><th className="p-3">Name</th><th>Email</th><th>Prog.</th><th>Status</th><th>Joined</th><th>Last active</th></tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id} className="border-t line">
                <td className="p-3"><Link to={`/admin/users/${u.id}`} className="font-medium hover:underline">{u.full_name || "—"}</Link></td>
                <td className="ink-2">{u.email}</td><td>{programmes.find((p) => p.id === u.programme_id)?.code ?? "—"}</td>
                <td><StatusBadge status={u.status} /></td><td className="ink-2 text-xs">{dateShort(u.created_at)}</td><td className="ink-2 text-xs">{dateShort(u.last_active_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

interface Detail {
  profile: Record<string, unknown> & { id: string; email: string; full_name: string | null; status: string; programme: string | null; suspended_reason: string | null; created_at: string; last_active_at: string | null; exam_target_date: string | null; institution: string | null };
  roles: AppRole[];
  entitlements: Array<{ id: string; product_code: string; source: string; status: string; starts_at: string; expires_at: string | null; reason: string | null }>;
  subscriptions: Array<{ id: string; plan_code: string; status: string; source: string; ends_at: string; reason: string | null }>;
  wallet: { plan_code: string; balance: number; period_end: string } | null;
  payments: Array<{ id: string; reference: string; item_code: string; amount_kobo: number; status: string; mode: string; created_at: string }>;
  ai_usage_30d: { requests: number; credits: number };
  exam_attempts: number; practice_answered: number;
  tickets: Array<{ id: string; subject: string; status: string; created_at: string }>;
}
type ModalState = { title: string; fields: FieldDef[]; initial: object; submit: (v: Record<string, unknown>) => Promise<void> } | null;

function UserDetail({ id }: { id: string }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const { confirm, confirmNode } = useConfirm();
  const [modal, setModal] = useState<ModalState>(null);
  const { data, error, loading, reload } = useAsync(() => rpc<Detail>("admin_user_detail", { p_user: id }), [id]);
  const plans = useAsync(async () => must(await supabase.from("ai_plans").select("code, name").neq("code", "free").order("position")) as Array<{ code: string; name: string }>, []);

  const doRpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { await rpc(fn, args); toast(ok); reload(); } catch (e) { toast(friendly(e), "error"); }
  };

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "User not found"} onRetry={reload} />;
  const p = data.profile;
  const suspended = p.status === "suspended";

  return (
    <div>
      <Link to="/admin/users" className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Users</Link>
      <PageHeader title={p.full_name || p.email} subtitle={<>{p.email} · joined {dateShort(p.created_at)} · last active {dateTime(p.last_active_at)}</>}
        actions={<>
          <StatusBadge status={p.status} />
          {can("users.manage") && id !== user?.id && (
            <Button variant={suspended ? "secondary" : "danger"} size="sm" onClick={async () => {
              const reason = window.prompt(suspended ? "Reason for reactivating:" : "Reason for suspending (recorded in the audit log):");
              if (!reason) return;
              try { await callFunction("admin-users", { action: suspended ? "reactivate" : "suspend", userId: id, reason }); toast(suspended ? "Account reactivated" : "Account suspended"); reload(); }
              catch (e) { toast(friendly(e), "error"); }
            }}>{suspended ? "Reactivate" : "Suspend"}</Button>
          )}
          {can("users.manage") && <Button size="sm" variant="secondary" onClick={async () => {
            if (!(await confirm("Send password reset?", `A reset link will be emailed to ${p.email}. You won't see the password.`))) return;
            try { await callFunction("admin-users", { action: "password_reset", userId: id }); toast("Reset email sent"); } catch (e) { toast(friendly(e), "error"); }
          }}>Send password reset</Button>}
        </>} />
      {suspended && p.suspended_reason && <ErrorBox message={`Suspended: ${p.suspended_reason}`} />}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 font-semibold">Profile</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="ink-2">Programme</dt><dd className="flex items-center gap-2">{p.programme ?? "—"}
              {can("users.manage") && <select aria-label="Change programme" className="surface rounded border line text-xs" value="" onChange={(e) => e.target.value && doRpc("admin_set_programme", { p_user: id, p_programme: e.target.value }, "Programme updated")}>
                <option value="">change…</option><option value="RN">RN</option><option value="RM">RM</option></select>}</dd></div>
            <div className="flex justify-between"><dt className="ink-2">Institution</dt><dd>{p.institution ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="ink-2">Exam date</dt><dd>{dateShort(p.exam_target_date)}</dd></div>
            <div className="flex justify-between"><dt className="ink-2">Questions answered</dt><dd>{data.practice_answered}</dd></div>
            <div className="flex justify-between"><dt className="ink-2">Exam attempts</dt><dd>{data.exam_attempts}</dd></div>
            <div className="flex justify-between"><dt className="ink-2">AI (30 days)</dt><dd>{data.ai_usage_30d.requests} requests · {data.ai_usage_30d.credits} credits</dd></div>
          </dl>
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Exam access</h2>
            {can("access.grant") && <Button size="sm" icon="plus" onClick={() => setModal({
              title: "Grant complimentary access",
              fields: [{ key: "product", label: "Section", type: "select", options: [["section_c", PRODUCT_LABEL.section_c], ["section_d", PRODUCT_LABEL.section_d]] },
                { key: "days", label: "Days (blank = no expiry)", type: "number" }, { key: "reason", label: "Reason (audited)", required: true }],
              initial: { product: "section_c", days: 30 },
              submit: async (v) => { await rpc("admin_grant_entitlement", { p_user: id, p_product: v.product, p_days: v.days === "" || v.days == null ? null : Number(v.days), p_reason: v.reason }); reload(); },
            })}>Grant</Button>}
          </div>
          {!data.entitlements.length ? <p className="ink-2 text-sm">No access records.</p> : (
            <ul className="space-y-2 text-sm">
              {data.entitlements.map((e) => (
                <li key={e.id} className="rounded-lg border line p-2">
                  <div className="flex items-center gap-2"><span className="font-medium">{PRODUCT_LABEL[e.product_code] ?? e.product_code}</span><StatusBadge status={e.status} /></div>
                  <div className="ink-2 text-xs">{e.source.replace("_", " ")} · {e.expires_at ? `expires ${dateShort(e.expires_at)}` : "no expiry"}{e.reason ? ` · ${e.reason}` : ""}</div>
                  {can("access.grant") && e.status === "active" && (
                    <div className="mt-1 flex gap-3 text-xs">
                      <button className="underline" onClick={() => { const d = Number(window.prompt("Extend by how many days?", "30")); if (d > 0) doRpc("admin_extend_entitlement", { p_id: e.id, p_days: d }, "Extended"); }}>Extend</button>
                      <button className="text-red-600 underline" onClick={() => { const r = window.prompt("Reason for revoking:"); if (r) doRpc("admin_revoke_entitlement", { p_id: e.id, p_reason: r }, "Revoked"); }}>Revoke</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">AI plan & credits</h2>
          </div>
          {data.wallet && <p className="text-sm"><b>{data.wallet.balance}</b> credits · {data.wallet.plan_code} plan · period ends {dateShort(data.wallet.period_end)}</p>}
          <ul className="ink-2 mt-2 space-y-1 text-xs">{data.subscriptions.map((s) => <li key={s.id}>{s.plan_code} · {s.status} · {s.source.replace("_", " ")} · until {dateShort(s.ends_at)}</li>)}</ul>
          {can("access.grant") && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setModal({
                title: "Grant complimentary AI plan",
                fields: [{ key: "plan", label: "Plan", type: "select", options: (plans.data ?? []).map((x) => [x.code, x.name] as [string, string]) },
                  { key: "days", label: "Days", type: "number" }, { key: "reason", label: "Reason (audited)", required: true }],
                initial: { plan: plans.data?.[0]?.code, days: 30 },
                submit: async (v) => { await rpc("admin_grant_plan", { p_user: id, p_plan: v.plan, p_days: Number(v.days || 30), p_reason: v.reason }); reload(); },
              })}>Grant plan</Button>
              <Button size="sm" variant="secondary" onClick={() => setModal({
                title: "Adjust credits",
                fields: [{ key: "delta", label: "Credits to add (use a negative number to remove)", type: "number", required: true }, { key: "reason", label: "Reason (audited)", required: true }],
                initial: { delta: 50 },
                submit: async (v) => { await rpc("admin_adjust_credits", { p_user: id, p_delta: Number(v.delta), p_reason: v.reason }); reload(); },
              })}>Adjust credits</Button>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-2 font-semibold">Payments</h2>
          {!data.payments.length ? <p className="ink-2 text-sm">No payments.</p> : (
            <table className="w-full text-sm"><tbody>{data.payments.map((x) => (
              <tr key={x.id} className="border-t line"><td className="py-1.5 font-mono text-xs">{x.reference}</td><td>{x.item_code}</td><td>{naira(x.amount_kobo)}</td><td><StatusBadge status={x.status} /></td><td><Badge>{x.mode}</Badge></td><td className="ink-2 text-xs">{dateTime(x.created_at)}</td></tr>
            ))}</tbody></table>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Admin roles</h2>
          <div className="flex flex-wrap gap-1">{data.roles.length ? data.roles.map((r) => <Badge key={r} tone="brand">{r.replace("_", " ")}</Badge>) : <span className="ink-2 text-sm">Student (no admin role)</span>}</div>
          {can("roles.manage") && (
            <div className="mt-3 space-y-1">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={data.roles.includes(r)} onChange={async (e) => {
                    if (!(await confirm(`${e.target.checked ? "Grant" : "Remove"} ${r.replace("_", " ")}?`, "Role changes take effect immediately and are audited.", { danger: r === "super_admin" }))) return;
                    doRpc("admin_set_role", { p_user: id, p_role: r, p_grant: e.target.checked }, "Roles updated");
                  }} />{r.replace("_", " ")}
                </label>
              ))}
            </div>
          )}
        </Card>

        {data.tickets.length > 0 && (
          <Card className="lg:col-span-3">
            <h2 className="mb-2 font-semibold">Support tickets</h2>
            <ul className="space-y-1 text-sm">{data.tickets.map((t) => <li key={t.id} className="flex items-center gap-2"><StatusBadge status={t.status} />{t.subject}<span className="ink-2 text-xs">{dateShort(t.created_at)}</span></li>)}</ul>
            <Link to="/admin/reports?tab=tickets" className="mt-2 inline-block text-sm underline">Open support inbox</Link>
          </Card>
        )}
      </div>
      {modal && <FormModal title={modal.title} fields={modal.fields} initial={modal.initial} onSubmit={async (v) => { await modal.submit(v); toast("Saved"); }} onClose={() => setModal(null)} />}
      {confirmNode}
    </div>
  );
}
