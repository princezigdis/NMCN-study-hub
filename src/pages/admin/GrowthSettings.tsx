import { type ChangeEvent, useEffect, useState } from "react";
import { Button, Card, Field, Input, Select, Toggle, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

/** Reads/writes one app_settings row. Rows are seeded by migration; update is enough. */
function useSetting<T>(key: string, fallback: T) {
  const toast = useToast();
  const q = useAsync(async () => {
    const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
    return ((data?.value as T | undefined) ?? fallback) as T;
  }, [key]);
  const save = async (value: T, okMsg = "Saved") => {
    const { error } = await supabase.from("app_settings").upsert({ key, value }, { onConflict: "key" });
    toast(error ? friendly(error) : okMsg, error ? "error" : "success");
    if (!error) q.reload();
    return !error;
  };
  return { value: q.data, save };
}

export default function GrowthSettings() {
  return (
    <>
      <SiteControls />
      <ReferralRewards />
      <TrackFee />
      <VideoFilter />
    </>
  );
}

function SiteControls() {
  const banner = useSetting("site.banner", { visible: false, text: "", tone: "info" });
  const maint = useSetting("site.maintenance", { enabled: false, message: "" });
  const [b, setB] = useState({ visible: false, text: "", tone: "info" });
  const [m, setM] = useState({ enabled: false, message: "" });
  useEffect(() => { if (banner.value) setB(banner.value); }, [banner.value]);
  useEffect(() => { if (maint.value) setM(maint.value); }, [maint.value]);
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Site announcement &amp; maintenance</h2>
      <div className="space-y-3">
        <Toggle checked={b.visible} onChange={(v) => setB({ ...b, visible: v })} label="Show announcement banner to students" />
        <Field label="Banner text">{(id) => <Input id={id} value={b.text} maxLength={240} onChange={(e) => setB({ ...b, text: e.target.value })} />}</Field>
        <Field label="Style">{(id) => <Select id={id} value={b.tone} onChange={(e) => setB({ ...b, tone: e.target.value })}><option value="info">Information</option><option value="warning">Warning</option></Select>}</Field>
        <Button onClick={() => banner.save(b, "Banner updated")}>Save banner</Button>
      </div>
      <hr className="line" />
      <div className="space-y-3">
        <Toggle checked={m.enabled} onChange={(v) => setM({ ...m, enabled: v })} label="Maintenance mode (students see a notice; staff can still sign in)" />
        <Field label="Maintenance message">{(id) => <Input id={id} value={m.message} maxLength={240} onChange={(e) => setM({ ...m, message: e.target.value })} />}</Field>
        <Button onClick={() => maint.save(m, m.enabled ? "Maintenance mode is ON" : "Maintenance mode is off")}>Save maintenance settings</Button>
      </div>
    </Card>
  );
}

function ReferralRewards() {
  const s = useSetting("referral.rewards", { enabled: true, referrer_credits: 20, referred_credits: 10, max_per_referrer: 50 });
  const [v, setV] = useState({ enabled: true, referrer_credits: 20, referred_credits: 10, max_per_referrer: 50 });
  useEffect(() => { if (s.value) setV(s.value); }, [s.value]);
  const num = (k: "referrer_credits" | "referred_credits" | "max_per_referrer") => (e: ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: Math.max(0, Math.min(10000, Number(e.target.value) || 0)) });
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Referral rewards</h2>
      <Toggle checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="Referral programme enabled" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Credits for the referrer">{(id) => <Input id={id} type="number" min={0} value={v.referrer_credits} onChange={num("referrer_credits")} />}</Field>
        <Field label="Credits for the new student">{(id) => <Input id={id} type="number" min={0} value={v.referred_credits} onChange={num("referred_credits")} />}</Field>
        <Field label="Max rewarded referrals per student">{(id) => <Input id={id} type="number" min={0} value={v.max_per_referrer} onChange={num("max_per_referrer")} />}</Field>
      </div>
      <Button onClick={() => s.save(v, "Referral rewards saved")}>Save rewards</Button>
    </Card>
  );
}

function TrackFee() {
  const s = useSetting<number>("pricing.track_switch_kobo", 100000);
  const [naira, setNaira] = useState(1000);
  useEffect(() => { if (typeof s.value === "number") setNaira(s.value / 100); }, [s.value]);
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Track switch fee</h2>
      <p className="ink-2 text-sm">One-time price (₦) for a student to move between RN and RM.</p>
      <div className="flex items-end gap-3">
        <Field label="Fee (₦)">{(id) => <Input id={id} type="number" min={100} className="w-40" value={naira} onChange={(e) => setNaira(Number(e.target.value) || 0)} />}</Field>
        <Button onClick={() => naira >= 100 && s.save(Math.round(naira * 100), "Fee saved")} disabled={naira < 100}>Save fee</Button>
      </div>
    </Card>
  );
}

function VideoFilter() {
  const s = useSetting("video.filter", { medical_only: true });
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Procedure video filter</h2>
      <Toggle checked={s.value?.medical_only !== false} onChange={(v) => s.save({ medical_only: v }, v ? "Medical-only filter ON" : "Medical-only filter OFF")}
        label="Only show medical / nursing / midwifery videos (recommended)" />
    </Card>
  );
}
