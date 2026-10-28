import { useState } from "react";
import { Badge, Card, ErrorBox, Input, Loading, PageHeader, Select } from "../../components/ui";
import { dateTime } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

interface Log { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null; created_at: string }

/** Append-only record of sensitive changes (roles, access, prices, settings, publishing…). */
export default function AdminAudit() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const staff = useAsync(async () => {
    const { data } = await supabase.rpc("admin_staff");
    return new Map(((data ?? []) as Array<{ user_id: string; email: string }>).map((s) => [s.user_id, s.email]));
  }, []);
  const { data, error, loading } = useAsync(async () => {
    let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(300);
    if (entity) q = q.eq("entity_type", entity);
    if (action) q = q.eq("action", action);
    if (actor.trim()) q = q.eq("actor_id", actor.trim());
    return must(await q) as Log[];
  }, [entity, action, actor]);

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Who changed what, and when. Entries can't be edited or deleted." />
      <Card className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entity">
          <option value="">All entities</option>
          {["entitlements", "user_roles", "ai_subscriptions", "credit_wallets", "products", "ai_plans", "ai_action_costs", "app_settings", "feature_flags", "refunds", "profiles", "questions", "note_versions", "exam_configs", "exam_papers", "notifications", "courses", "topics", "notes"].map((e) => <option key={e}>{e}</option>)}
        </Select>
        <Select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>{["INSERT", "UPDATE", "DELETE", "STATUS", "PUBLISH", "REJECT", "IMPORT", "CREDITS", "BROADCAST", "PROGRAMME", "PASSWORD_RESET_SENT"].map((a) => <option key={a}>{a}</option>)}
        </Select>
        <Input placeholder="Actor user id" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor" />
      </Card>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-[var(--line)]">
          {data?.map((l) => (
            <li key={l.id} className="px-4 py-2 text-sm">
              <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <span className="ink-2 w-36 shrink-0 text-xs">{dateTime(l.created_at)}</span>
                <Badge tone={l.action === "DELETE" ? "danger" : l.action === "INSERT" ? "success" : "info"}>{l.action}</Badge>
                <span className="font-medium">{l.entity_type}</span>
                <span className="ink-2 truncate font-mono text-xs">{l.entity_id}</span>
                <span className="ink-2 ml-auto text-xs">{l.actor_id ? staff.data?.get(l.actor_id) ?? l.actor_id.slice(0, 8) : "system"}</span>
              </button>
              {l.note && <p className="ink-2 ml-36 text-xs">{l.note}</p>}
              {open === l.id && (
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <pre className="surface-2 max-h-64 overflow-auto rounded-lg p-2 text-[11px]">{JSON.stringify(l.before, null, 2) ?? "—"}</pre>
                  <pre className="surface-2 max-h-64 overflow-auto rounded-lg p-2 text-[11px]">{JSON.stringify(l.after, null, 2) ?? "—"}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
