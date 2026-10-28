import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Button, cx, ErrorBox, Field, Input } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import { useNavigate } from "../../lib/router";

/** First-run: choose RN or RM pathway, optional school and exam date. */
export default function OnboardingPage() {
  const { profile, programmes, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [programmeId, setProgrammeId] = useState(profile?.programme_id ?? "");
  const [name, setName] = useState(profile?.full_name ?? "");
  const [school, setSchool] = useState(profile?.institution ?? "");
  const [examDate, setExamDate] = useState(profile?.exam_target_date ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!programmeId) return setError("Choose your programme to continue.");
    setBusy(true); setError(null);
    const { data: cv } = await supabase.from("curriculum_versions").select("id").eq("programme_id", programmeId)
      .eq("status", "published").order("effective_from", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const { error } = await supabase.from("profiles").update({
      programme_id: programmeId, full_name: name.trim() || null, institution: school.trim() || null,
      exam_target_date: examDate || null, curriculum_version_id: cv?.id ?? null, onboarded: true,
    }).eq("id", profile!.id);
    setBusy(false);
    if (error) return setError(friendly(error));
    await refreshProfile();
    navigate("/", { replace: true });
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <img src="/favicon.svg" alt="" className="mb-6 h-10 w-10" />
      <h1 className="text-2xl font-bold">Let's set up your study space</h1>
      <p className="ink-2 mt-1 text-sm">You can change these later in your profile.</p>
      <div className="mt-6 space-y-5">
        {error && <ErrorBox message={error} />}
        <div>
          <div className="mb-2 text-sm font-medium">Which programme are you preparing for?</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {programmes.map((p) => (
              <button key={p.id} onClick={() => setProgrammeId(p.id)} aria-pressed={programmeId === p.id}
                className={cx("rounded-2xl border-2 p-4 text-left transition-colors", programmeId === p.id ? "border-brand-600 bg-brand-50 dark:bg-brand-900/40" : "line surface hover:border-brand-300")}>
                <div className="text-2xl font-bold text-brand-700 dark:text-brand-300">{p.code}</div>
                <div className="font-medium">{p.name}</div>
              </button>
            ))}
          </div>
        </div>
        <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
        <Field label="School / institution (optional)">{(id) => <Input id={id} value={school} onChange={(e) => setSchool(e.target.value)} maxLength={160} />}</Field>
        <Field label="Planned exam date (optional)" hint="We'll show a countdown and suggest a pace.">{(id) => <Input id={id} type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />}</Field>
        <Button size="lg" className="w-full" onClick={save} loading={busy}>Start studying</Button>
      </div>
    </div>
  );
}
