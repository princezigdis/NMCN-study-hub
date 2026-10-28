import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea, Toggle, useConfirm, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { Link } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";
import { must } from "./adminKit";

export default function AdminSettings() {
  const { can } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings & roles" />
      {can("settings.manage") && <Flags />}
      {can("settings.manage") && <PaymentMode />}
      {can("notifications.send") && <Broadcast />}
      {can("users.view") && <Staff />}
    </div>
  );
}

function Flags() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(async () => must(await supabase.from("feature_flags").select("*").order("key")) as Array<{ key: string; enabled: boolean; description: string | null }>, []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Feature flags</h2>
      <ul className="space-y-3">
        {data?.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-3">
            <div><div className="font-mono text-sm">{f.key}</div><div className="ink-2 text-xs">{f.description}</div></div>
            <Toggle checked={f.enabled} label={f.enabled ? "On" : "Off"} onChange={async (v) => {
              const { error } = await supabase.from("feature_flags").update({ enabled: v }).eq("key", f.key);
              if (error) toast(friendly(error), "error"); else reload();
            }} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PaymentMode() {
  const toast = useToast();
  const { confirm, confirmNode } = useConfirm();
  const { data, reload } = useAsync(async () => (must(await supabase.from("app_settings").select("value").eq("key", "payments.config").single()) as { value: { mode: string; provider: string; callback_path: string } }).value, []);
  const [mode, setMode] = useState("test");
  useEffect(() => { if (data) setMode(data.mode); }, [data]);
  const save = async () => {
    if (mode === "live" && !(await confirm("Switch to LIVE payments?", <>
      Real cards will be charged. Before switching, confirm: the Paystack business account is verified, <code>PAYSTACK_SECRET_KEY</code> is set to an <code>sk_live_</code> key,
      the webhook URL is configured in the Paystack dashboard, and a test purchase has succeeded end-to-end in test mode.
    </>, { danger: true, confirmLabel: "Go live" }))) return;
    const { error } = await supabase.from("app_settings").update({ value: { ...data, mode } }).eq("key", "payments.config");
    toast(error ? friendly(error) : `Payment mode: ${mode}`, error ? "error" : "success");
    reload();
  };
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Payments</h2>
      <p className="ink-2 mb-3 text-sm">The server refuses checkouts when this mode doesn't match the type of Paystack key installed (test vs live).</p>
      <div className="flex items-center gap-3">
        <Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-40" aria-label="Payment mode"><option value="test">Test (sandbox)</option><option value="live">Live</option></Select>
        <Badge tone={data?.mode === "live" ? "success" : "warning"}>Currently {data?.mode}</Badge>
        <Button onClick={save} disabled={mode === data?.mode}>Save</Button>
      </div>
      {confirmNode}
    </Card>
  );
}

function Broadcast() {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [prog, setProg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!title.trim()) return toast("Add a title", "error");
    setBusy(true);
    try {
      const n = await rpc<number>("admin_broadcast", { p_title: title, p_body: body, p_link: link.startsWith("/") ? link : null, p_programme: prog || null });
      toast(`Sent to ${n} students`);
      setTitle(""); setBody(""); setLink("");
    } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Send an announcement</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2"><Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}</Field></div>
        <Field label="Audience">{(id) => <Select id={id} value={prog} onChange={(e) => setProg(e.target.value)}><option value="">Everyone</option><option value="RN">RN students</option><option value="RM">RM students</option></Select>}</Field>
      </div>
      <Field label="Message">{(id) => <Textarea id={id} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />}</Field>
      <Field label="Link inside the app (optional)" hint="e.g. /mock or /library">{(id) => <Input id={id} value={link} onChange={(e) => setLink(e.target.value)} />}</Field>
      <Button onClick={send} loading={busy}>Send announcement</Button>
    </Card>
  );
}

function Staff() {
  const { data, error, loading } = useAsync(() => rpc<Array<{ user_id: string; email: string; full_name: string | null; roles: string[] }>>("admin_staff"), []);
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Admin accounts</h2>
      <p className="ink-2 mb-3 text-sm">Grant or remove roles from a user's page under Users (super admins only).</p>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      <ul className="divide-y divide-[var(--line)]">
        {data?.map((s) => (
          <li key={s.user_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <Link to={`/admin/users/${s.user_id}`} className="font-medium underline">{s.full_name || s.email}</Link>
            <span className="ink-2 text-xs">{s.email}</span>
            <div className="ml-auto flex flex-wrap gap-1">{s.roles.map((r) => <Badge key={r} tone="brand">{r.replace("_", " ")}</Badge>)}</div>
          </li>
        ))}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium">What each role can do</summary>
        <ul className="ink-2 mt-2 list-disc space-y-1 pl-5 text-xs">
          <li><b>super admin</b>: everything, including roles, settings, AI configuration and the audit log.</li>
          <li><b>content admin</b>: curriculum, notes (write and publish), content reports.</li>
          <li><b>question admin</b>: write and import questions (publishing needs a reviewer).</li>
          <li><b>reviewer</b>: clinically review and publish notes and questions.</li>
          <li><b>exam admin</b>: configure Sections C and D, pools and stations.</li>
          <li><b>support</b>: view and manage students, grant complimentary access, answer tickets, send announcements.</li>
          <li><b>finance</b>: payments, refunds and pricing.</li>
        </ul>
      </details>
    </Card>
  );
}
