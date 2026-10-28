import { useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, StatusBadge, Textarea, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { dateTime } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

interface Ticket { id: string; subject: string; body: string; category: string; status: string; admin_reply: string | null; created_at: string }

export default function SupportPage() {
  const toast = useToast();
  const [form, setForm] = useState({ subject: "", body: "", category: "general" });
  const [busy, setBusy] = useState(false);
  const tickets = useAsync(async () => {
    const { data, error } = await supabase.from("support_tickets").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data as Ticket[];
  }, []);

  const send = async () => {
    if (form.subject.trim().length < 3 || form.body.trim().length < 3) return toast("Add a subject and a message", "error");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("support_tickets").insert({ user_id: u.user?.id, subject: form.subject.trim(), body: form.body.trim(), category: form.category });
    setBusy(false);
    if (error) return toast(friendly(error), "error");
    toast("Message sent. We'll reply here.");
    setForm({ subject: "", body: "", category: "general" });
    tickets.reload();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Help & support" subtitle="Payment issues, access problems or content questions — we'll reply here." />
      <Card className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Subject">{(id) => <Input id={id} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={200} />}</Field></div>
          <Field label="Category">{(id) => (
            <Select id={id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="general">General</option><option value="payment">Payment</option><option value="access">Access</option>
              <option value="content">Content</option><option value="technical">Technical</option>
            </Select>
          )}</Field>
        </div>
        <Field label="Message" hint="For payment issues, include the payment reference if you have it.">{(id) => <Textarea id={id} rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={6000} />}</Field>
        <Button onClick={send} loading={busy}>Send message</Button>
      </Card>
      <section>
        <h2 className="mb-3 font-semibold">Your messages</h2>
        {tickets.loading && <Loading />}
        {tickets.error && <ErrorBox message={tickets.error} />}
        <div className="space-y-2">
          {tickets.data?.map((t) => (
            <Card key={t.id}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{t.subject}</span><StatusBadge status={t.status} /></div>
              <div className="ink-2 text-xs">{dateTime(t.created_at)} · {t.category}</div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{t.body}</p>
              {t.admin_reply && <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-900/40"><b>Support:</b> <span className="whitespace-pre-wrap">{t.admin_reply}</span></div>}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
