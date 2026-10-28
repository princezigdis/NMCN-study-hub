import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Select, StatusBadge, Tabs, Textarea, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { dateTime } from "../../lib/format";
import { Link, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

export default function AdminReports() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tickets" ? "tickets" : "reports";
  return (
    <div>
      <PageHeader title="Reports & support" subtitle="Student reports of incorrect content or AI errors, and support requests." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ id: "reports", label: "Content & AI reports" }, { id: "tickets", label: "Support tickets" }]} />
      {tab === "reports" ? <Reports /> : <Tickets />}
    </div>
  );
}

interface Report { id: string; user_id: string; target_type: string; target_id: string | null; reason: string; details: string | null; status: string; admin_notes: string | null; created_at: string; profiles: { email: string | null } | null }

function targetLink(r: Report): string | null {
  if (!r.target_id) return null;
  if (r.target_type === "note") return `/admin/notes/${r.target_id}`;
  if (r.target_type === "question") return `/admin/questions/${r.target_id}`;
  if (r.target_type === "station") return `/admin/stations/${r.target_id}`;
  return null;
}

function Reports() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const type = params.get("type") ?? "";
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from("content_reports").select("*, profiles(email)").order("created_at", { ascending: false }).limit(200);
    if (status) q = q.eq("status", status);
    if (type) q = q.eq("target_type", type);
    return must(await q) as unknown as Report[];
  }, [status, type]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [aiOut, setAiOut] = useState<Record<string, string>>({});

  const update = async (r: Report, next: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("content_reports").update({
      status: next, admin_notes: notes[r.id] ?? r.admin_notes,
      resolved_by: ["resolved", "dismissed"].includes(next) ? u.user?.id : null,
      resolved_at: ["resolved", "dismissed"].includes(next) ? new Date().toISOString() : null,
    }).eq("id", r.id);
    if (error) toast(friendly(error), "error"); else reload();
  };
  const loadAi = async (id: string) => {
    const { data } = await supabase.from("ai_requests").select("action, model, output_excerpt").eq("id", id).maybeSingle();
    setAiOut((o) => ({ ...o, [id]: data ? `[${data.action} · ${data.model}]\n\n${data.output_excerpt ?? "(no output stored)"}` : "Not found or no permission." }));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select value={status} onChange={(e) => setParams({ status: e.target.value })} className="w-40" aria-label="Status"><option value="">All</option><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></Select>
        <Select value={type} onChange={(e) => setParams({ type: e.target.value || null })} className="w-44" aria-label="Type"><option value="">All types</option><option value="note">Notes</option><option value="question">Questions</option><option value="ai_response">AI responses</option><option value="station">Stations</option></Select>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && !data.length && <EmptyState icon="checkCircle" title="Nothing here" />}
      {data?.map((r) => {
        const link = targetLink(r);
        return (
          <Card key={r.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{r.target_type.replace("_", " ")}</Badge><Badge tone="warning">{r.reason}</Badge><StatusBadge status={r.status} />
              <span className="ink-2 text-xs">{r.profiles?.email} · {dateTime(r.created_at)}</span>
              <div className="flex-1" />
              {link && <Link to={link} className="text-sm underline">Open item</Link>}
              {r.target_type === "ai_response" && r.target_id && <button className="text-sm underline" onClick={() => loadAi(r.target_id!)}>Show AI output</button>}
            </div>
            {r.details && <p className="whitespace-pre-wrap text-sm">{r.details}</p>}
            {aiOut[r.target_id ?? ""] && <pre className="surface-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-xs">{aiOut[r.target_id!]}</pre>}
            <Textarea rows={2} placeholder="Reviewer notes (what was checked / changed)" value={notes[r.id] ?? r.admin_notes ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
            <div className="flex flex-wrap gap-2">
              {r.status === "open" && <Button size="sm" variant="secondary" onClick={() => update(r, "reviewing")}>Start review</Button>}
              <Button size="sm" onClick={() => update(r, "resolved")}>Resolved (content fixed)</Button>
              <Button size="sm" variant="ghost" onClick={() => update(r, "dismissed")}>Dismiss</Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

interface Ticket { id: string; user_id: string; subject: string; body: string; category: string; status: string; admin_reply: string | null; created_at: string; profiles: { email: string | null; full_name: string | null } | null }

function Tickets() {
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from("support_tickets").select("*, profiles(email, full_name)").order("created_at", { ascending: true }).limit(200);
    if (status) q = q.eq("status", status);
    return must(await q) as unknown as Ticket[];
  }, [status]);
  const [reply, setReply] = useState<Record<string, string>>({});

  const send = async (t: Ticket, close: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    const text = reply[t.id] ?? t.admin_reply ?? "";
    const { error } = await supabase.from("support_tickets").update({ admin_reply: text || null, replied_by: u.user?.id, replied_at: new Date().toISOString(), status: close ? "closed" : "pending" }).eq("id", t.id);
    if (error) return toast(friendly(error), "error");
    // Let the student know there's a reply.
    await supabase.rpc("admin_notify_user", { p_user: t.user_id, p_title: "Support replied", p_body: t.subject, p_link: "/support" }).then(() => undefined, () => undefined);
    toast("Reply saved");
    reload();
  };

  return (
    <div className="space-y-3">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status"><option value="">All</option><option value="open">Open</option><option value="pending">Pending</option><option value="closed">Closed</option></Select>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && !data.length && <EmptyState icon="checkCircle" title="Inbox zero" />}
      {data?.map((t) => (
        <Card key={t.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t.subject}</span><Badge>{t.category}</Badge><StatusBadge status={t.status} />
            <span className="ink-2 text-xs"><Link to={`/admin/users/${t.user_id}`} className="underline">{t.profiles?.full_name || t.profiles?.email}</Link> · {dateTime(t.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{t.body}</p>
          <Textarea rows={3} placeholder="Reply to the student…" value={reply[t.id] ?? t.admin_reply ?? ""} onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => send(t, false)}>Send reply</Button>
            <Button size="sm" variant="secondary" onClick={() => send(t, true)}>Reply & close</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
