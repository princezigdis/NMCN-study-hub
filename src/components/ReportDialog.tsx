import { useState } from "react";
import { supabase } from "../lib/supabase";
import { friendly } from "../lib/errors";
import { Button, Field, Modal, Select, Textarea, useToast } from "./ui";

export type ReportTarget = "note" | "question" | "ai_response" | "station" | "other";

/** Lets students flag incorrect / outdated content or AI errors for admin review. */
export function ReportDialog({ open, onClose, targetType, targetId, context }: {
  open: boolean; onClose: () => void; targetType: ReportTarget; targetId?: string | null; context?: string;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("incorrect");
  const [details, setDetails] = useState(context ? `Regarding: "${context.slice(0, 300)}"\n\n` : "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("content_reports").insert({
      user_id: u.user?.id, target_type: targetType, target_id: targetId ?? null, reason, details: details.slice(0, 4000),
    });
    setBusy(false);
    if (error) { toast(friendly(error), "error"); return; }
    toast("Thanks — our reviewers will check this.");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Report a problem"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Send report</Button></>}>
      <div className="space-y-4">
        <Field label="What's wrong?">{(id) => (
          <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="incorrect">Clinically incorrect</option>
            <option value="outdated">Outdated guidance</option>
            <option value="unclear">Unclear or confusing</option>
            <option value="typo">Typo / formatting</option>
            <option value="copyright">Copyright concern</option>
            <option value="offensive">Inappropriate content</option>
            <option value="other">Other</option>
          </Select>
        )}</Field>
        <Field label="Details" hint="Include the correct information and a source if you can.">{(id) => (
          <Textarea id={id} rows={5} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} />
        )}</Field>
      </div>
    </Modal>
  );
}
