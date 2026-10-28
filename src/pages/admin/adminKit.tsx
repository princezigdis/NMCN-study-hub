// Small building blocks shared by admin screens.
import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Field, Input, Modal, Select, StatusBadge, Textarea, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";
import { friendly } from "../../lib/errors";
import type { PublicationStatus } from "../../lib/types";

export const STATUSES: PublicationStatus[] = ["draft", "in_review", "published", "unpublished", "archived"];

/** Status dropdown for curriculum entities (publishing requires the reviewer permission server-side). */
export function ContentStatus({ table, id, status, onChange }: { table: string; id: string; status: PublicationStatus; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge status={status} />
      <select aria-label="Change status" disabled={busy} value="" className="surface rounded border line px-1 py-0.5 text-xs"
        onChange={async (e) => {
          const next = e.target.value as PublicationStatus;
          if (!next) return;
          setBusy(true);
          try { await rpc("admin_set_content_status", { p_table: table, p_id: id, p_status: next }); onChange(); }
          catch (err) { toast(friendly(err), "error"); }
          setBusy(false);
        }}>
        <option value="">Set…</option>
        {STATUSES.filter((s) => s !== status).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
      </select>
    </span>
  );
}

/** Up/down reorder using admin_reorder (persists the full order). */
export function ReorderButtons<T extends { id: string }>({ table, list, index, onDone }: { table: string; list: T[]; index: number; onDone: () => void }) {
  const toast = useToast();
  const move = async (dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try { await rpc("admin_reorder", { p_table: table, p_ids: ids }); onDone(); }
    catch (e) { toast(friendly(e), "error"); }
  };
  return (
    <span className="inline-flex">
      <button className="ink-2 rounded p-0.5 hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={index === 0} onClick={() => move(-1)} aria-label="Move up"><Icon name="chevronDown" size={16} className="rotate-180" /></button>
      <button className="ink-2 rounded p-0.5 hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={index === list.length - 1} onClick={() => move(1)} aria-label="Move down"><Icon name="chevronDown" size={16} /></button>
    </span>
  );
}

export interface FieldDef { key: string; label: string; type?: "text" | "textarea" | "number" | "date" | "select" | "checkbox"; options?: Array<[string, string]>; required?: boolean; hint?: string }

/** Generic create/edit form in a modal. */
export function FormModal({ title, fields, initial, onSubmit, onClose }: {
  title: string; fields: FieldDef[]; initial: object;
  onSubmit: (values: Record<string, unknown>) => Promise<void>; onClose: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, unknown>>({ ...(initial as Record<string, unknown>) });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    for (const f of fields) if (f.required && !String(values[f.key] ?? "").trim()) return toast(`${f.label} is required`, "error");
    setBusy(true);
    try { await onSubmit(values); onClose(); } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        {fields.map((f) => f.type === "checkbox" ? (
          <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />{f.label}</label>
        ) : (
          <Field key={f.key} label={f.label} hint={f.hint}>{(id) =>
            f.type === "textarea" ? <Textarea id={id} rows={4} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
              : f.type === "select" ? (
                <Select id={id} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              ) : <Input id={id} type={f.type ?? "text"} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />
          }</Field>
        ))}
      </div>
    </Modal>
  );
}

/** Throw Supabase errors so callers can rely on try/catch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must<T = any>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
