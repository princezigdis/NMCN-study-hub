import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Button, Card, Field, Input, PageHeader, useToast } from "../../components/ui";
import { BASE } from "../../lib/router";
import { friendly } from "../../lib/errors";
import { dateShort, naira, PRODUCT_LABEL } from "../../lib/format";
import { api } from "../../lib/api";
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
      exam_target_date: form.exam_target_date || null,
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
          <Field label="Study track" hint="Locked after registration. Switching is a paid option below.">{(id) => (
            <Input id={id} value={programmes.find((p) => p.id === profile?.programme_id)?.name ?? ""} disabled readOnly />
          )}</Field>
          <Field label="Exam date">{(id) => <Input id={id} type="date" value={form.exam_target_date} onChange={(e) => setForm({ ...form, exam_target_date: e.target.value })} />}</Field>
          <Field label="School / institution">{(id) => <Input id={id} value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} maxLength={160} />}</Field>
        </div>
        <Button onClick={save} loading={busy}>Save changes</Button>
      </Card>

      <TrackSwitchCard />
      <ReferralCard />

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
          const { error } = await supabase.auth.resetPasswordForEmail(user!.email!, { redirectTo: `${window.location.origin}${BASE}/reset-password` });
          toast(error ? friendly(error) : "Check your email for the reset link", error ? "error" : "success");
        }}>Change password</Button>
      </Card>
    </div>
  );
}

function TrackSwitchCard() {
  const { profile, programmes } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const info = useAsync(async () => ((await supabase.rpc("track_switch_info")).data as { fee_kobo: number } | null) ?? { fee_kobo: 100000 }, []);
  const other = programmes.find((p) => p.id !== profile?.programme_id);
  if (!other) return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.checkout("track_switch", other.code);
      window.location.href = r.authorizationUrl;
    } catch (e) { toast(friendly(e), "error"); setBusy(false); }
  };
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Switch study track</h2>
      <p className="ink-2 mb-3 text-sm">Your track is locked. You can move to {other.name} ({other.code}) for a one-time fee of {naira(info.data?.fee_kobo ?? 100000)}. Your progress is kept.</p>
      <Button variant="secondary" onClick={go} loading={busy}>Switch to {other.code} · {naira(info.data?.fee_kobo ?? 100000)}</Button>
    </Card>
  );
}

function ReferralCard() {
  const toast = useToast();
  const ref = useAsync(async () => (await supabase.rpc("my_referral")).data as
    { code: string; count: number; credits_earned: number; rewards: { enabled?: boolean; referrer_credits?: number; referred_credits?: number } } | null, []);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const d = ref.data;
  if (!d || d.rewards?.enabled === false) return null;
  const link = `${window.location.origin}${BASE}/auth?ref=${encodeURIComponent(d.code)}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast("Invite link copied"); } catch { toast("Copy the link manually", "error"); } };
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("set_referral_code", { p_code: custom });
    setBusy(false);
    if (error) return toast(/code_taken/.test(error.message) ? "That code is already taken." : /invalid_code/.test(error.message) ? "Use 4–16 letters or numbers." : friendly(error), "error");
    toast("Referral code updated"); setCustom(""); ref.reload();
  };
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Invite friends</h2>
      <p className="ink-2 text-sm">Share your code. You earn {d.rewards?.referrer_credits ?? 0} AI credits and your friend gets {d.rewards?.referred_credits ?? 0} when they join.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-lg font-bold tracking-widest">{d.code}</code>
        <Button variant="secondary" onClick={copy}>Copy invite link</Button>
      </div>
      <p className="ink-2 text-xs">{d.count} friend{d.count === 1 ? "" : "s"} joined · {d.credits_earned} credits earned</p>
      <div className="flex gap-2">
        <Input value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} placeholder="Choose a custom code" maxLength={16} aria-label="Custom referral code" />
        <Button variant="secondary" onClick={save} loading={busy} disabled={custom.length < 4}>Save</Button>
      </div>
    </Card>
  );
}
