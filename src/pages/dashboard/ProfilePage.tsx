import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Button, Card, Field, Input, PageHeader, Select, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { dateShort, naira, PRODUCT_LABEL } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

export default function ProfilePage() {
  const { profile, programmes, refreshProfile, user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? "", phone: profile?.phone ?? "", institution: profile?.institution ?? "",
    exam_target_date: profile?.exam_target_date ?? "", programme_id: profile?.programme_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const payments = useAsync(async () => (await supabase.from("payments").select("reference, item_code, purpose, amount_kobo, status, created_at")
    .order("created_at", { ascending: false }).limit(20)).data ?? [], []);
  const access = useAsync(async () => (await supabase.from("entitlements").select("product_code, status, expires_at, source").order("created_at", { ascending: false })).data ?? [], []);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({
      full_name: form.full_name.trim() || null, phone: form.phone.trim() || null, institution: form.institution.trim() || null,
      exam_target_date: form.exam_target_date || null, programme_id: form.programme_id || null,
    }).eq("id", profile!.id);
    setBusy(false);
    if (error) return toast(friendly(error), "error");
    await refreshProfile();
    toast("Profile updated");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Profile & account" subtitle={user?.email} />
      <Card className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name">{(id) => <Input id={id} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={120} />}</Field>
          <Field label="Phone (optional)">{(id) => <Input id={id} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} />}</Field>
          <Field label="Programme">{(id) => (
            <Select id={id} value={form.programme_id} onChange={(e) => setForm({ ...form, programme_id: e.target.value })}>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </Select>
          )}</Field>
          <Field label="Exam date">{(id) => <Input id={id} type="date" value={form.exam_target_date} onChange={(e) => setForm({ ...form, exam_target_date: e.target.value })} />}</Field>
          <Field label="School / institution">{(id) => <Input id={id} value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} maxLength={160} />}</Field>
        </div>
        <Button onClick={save} loading={busy}>Save changes</Button>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Exam access</h2>
        {!access.data?.length ? <p className="ink-2 text-sm">No paid sections yet.</p> : (
          <ul className="space-y-1 text-sm">{access.data.map((a, i) => (
            <li key={i}>{PRODUCT_LABEL[a.product_code] ?? a.product_code} · {a.status} · {a.expires_at ? `until ${dateShort(a.expires_at)}` : "no expiry"} · {a.source.replace("_", " ")}</li>
          ))}</ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Payment history</h2>
        {!payments.data?.length ? <p className="ink-2 text-sm">No payments yet.</p> : (
          <ul className="space-y-1 text-sm">{payments.data.map((p) => (
            <li key={p.reference} className="flex justify-between gap-2"><span>{p.item_code} · {dateShort(p.created_at)}</span><span>{naira(p.amount_kobo)} · {p.status}</span></li>
          ))}</ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Security</h2>
        <p className="ink-2 mb-3 text-sm">We'll email you a link to change your password.</p>
        <Button variant="secondary" onClick={async () => {
          const { error } = await supabase.auth.resetPasswordForEmail(user!.email!, { redirectTo: `${window.location.origin}/reset-password` });
          toast(error ? friendly(error) : "Check your email for the reset link", error ? "error" : "success");
        }}>Change password</Button>
      </Card>
    </div>
  );
}
