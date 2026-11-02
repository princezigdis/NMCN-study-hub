import { useState } from "react";
import { useAsync } from "../../lib/useAsync";
import { friendly } from "../../lib/errors";
import { sim3d } from "../../lib/sim3d";
import type { J } from "../../lib/lab";
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, Modal, Stat, Tabs, useConfirm, useToast } from "../../components/ui";

const tone = (s: string) => (s === "published" ? "success" : s === "draft" ? "warning" : "neutral") as "success" | "warning" | "neutral";
const FIELDS = ["scene", "steps", "unsafe", "challenges"] as const;
type Field = (typeof FIELDS)[number];

/** Checks a procedure's JSON before saving so a typo cannot break a student's session. */
function validate(p: Record<Field, unknown>): string | null {
  const steps = p.steps as J[];
  if (!Array.isArray(steps) || !steps.length) return "steps must be a non-empty list";
  const keys = new Set<string>();
  for (const s of steps) {
    if (!s.key || keys.has(s.key)) return `Duplicate or missing step key: ${s.key ?? "(none)"}`;
    keys.add(s.key);
    if (!["object", "zone", "position", "equipment", "choice"].includes(s.kind)) return `Step ${s.key}: unknown kind ${s.kind}`;
    if (typeof s.marks !== "number" || s.marks <= 0) return `Step ${s.key}: marks must be a positive number`;
    if (s.kind === "equipment" && !Array.isArray(s.items)) return `Step ${s.key}: equipment step needs items`;
    if (s.kind !== "equipment" && !Array.isArray(s.values)) return `Step ${s.key}: needs a values list`;
    if (s.kind === "choice" && (!Array.isArray(s.options) || !s.prompt)) return `Step ${s.key}: choice step needs prompt and options`;
  }
  for (const s of steps) for (const r of (s.requires ?? []) as string[]) if (!keys.has(r)) return `Step ${s.key}: requires unknown step ${r}`;
  const sc = p.scene as J;
  if (!sc || !Array.isArray(sc.actions)) return "scene.actions must be a list";
  const actionKeys = new Set((sc.actions as J[]).map((a) => a.key));
  for (const s of steps) if (s.kind === "object") for (const v of s.values as string[]) if (!actionKeys.has(v)) return `Step ${s.key}: action ${v} is not in scene.actions`;
  const unsafe = p.unsafe as J[];
  if (!Array.isArray(unsafe)) return "unsafe must be a list";
  for (const u of unsafe) for (const s of steps) if (s.kind === u.kind && Array.isArray(s.values) && s.values.includes(u.value)) return `Unsafe entry ${u.value} is also a correct step value (${s.key}); the unsafe rule would block it`;
  return null;
}

function Editor({ row, onClose, onSaved }: { row: J; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState<Record<Field, string>>(() => Object.fromEntries(FIELDS.map((f) => [f, JSON.stringify(row[f], null, 2)])) as Record<Field, string>);
  const [f, setF] = useState<Field>("steps");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const parsed = {} as Record<Field, unknown>;
    for (const k of FIELDS) {
      try { parsed[k] = JSON.parse(text[k]); } catch { toast(`"${k}" is not valid JSON`, "error"); setF(k); return; }
    }
    const err = validate(parsed);
    if (err) { toast(err, "error"); return; }
    setBusy(true);
    try { await sim3d.admin.save("procedure", { id: row.id, ...parsed }); toast("Saved. Version increased; publish again after review."); onSaved(); onClose(); }
    catch (e) { toast(friendly(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit: ${row.title}`} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Validate and save</Button></>}>
      <Tabs<Field> tabs={FIELDS.map((x) => ({ id: x, label: x }))} value={f} onChange={setF} />
      <textarea aria-label={`${f} JSON`} value={text[f]} onChange={(e) => setText({ ...text, [f]: e.target.value })} spellCheck={false}
        className="h-96 w-full rounded-lg border line bg-transparent p-3 font-mono text-xs" />
      <p className="ink-2 mt-2 text-xs">Each step has key, title, instruction, rationale, marks, kind (object, zone, position, equipment, choice), values or items, requires and critical. Saving checks keys, sequence and actions.</p>
    </Modal>
  );
}

export default function AdminSim3D() {
  const toast = useToast();
  const { confirm, confirmNode } = useConfirm();
  const [tab, setTab] = useState<"procedures" | "equipment" | "analytics">("procedures");
  const list = useAsync(() => sim3d.admin.list(), []);
  const stats = useAsync(() => sim3d.admin.analytics(), []);
  const [edit, setEdit] = useState<J | null>(null);
  const setStatus = async (kind: "procedure" | "equipment", row: J, status: string) => {
    if (status === "published" && !(await confirm("Publish?", "Students in Sections C and D will see this immediately. Confirm that a tutor has reviewed it.", { confirmLabel: "Publish" }))) return;
    try { await sim3d.admin.status(kind, row.id, status); toast(status === "published" ? "Published" : "Unpublished"); list.reload(); } catch (e) { toast(friendly(e), "error"); }
  };
  if (list.loading) return <Loading />;
  if (list.error || !list.data) return <ErrorBox message={list.error ?? "Could not load."} onRetry={list.reload} />;
  const d: J = list.data;
  return (
    <div>
      {confirmNode}
      <Tabs tabs={[{ id: "procedures", label: "3D procedures" }, { id: "equipment", label: "3D equipment" }, { id: "analytics", label: "3D analytics" }]} value={tab} onChange={setTab} />
      {tab === "procedures" && (d.procedures.length === 0 ? <EmptyState icon="cube" title="No 3D procedures" /> : (
        <Card className="divide-y line">
          {d.procedures.map((p: J) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0"><div className="font-medium">{p.title}</div><div className="ink-2 text-xs">{p.code} · {p.programme} · v{p.version} · {p.steps.length} steps{p.reviewer ? ` · ${p.reviewer}` : ""}</div></div>
              <div className="flex items-center gap-2"><Badge tone={tone(p.status)}>{p.status}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>
                {p.status === "published" ? <Button size="sm" variant="secondary" onClick={() => setStatus("procedure", p, "unpublished")}>Unpublish</Button> : <Button size="sm" onClick={() => setStatus("procedure", p, "published")}>Publish</Button>}</div>
            </div>
          ))}
        </Card>
      ))}
      {tab === "equipment" && (
        <Card className="divide-y line">
          {d.equipment.map((e: J) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0"><div className="font-medium">{e.name}</div><div className="ink-2 text-xs">{e.key} · {e.category}</div></div>
              <div className="flex items-center gap-2"><Badge tone={tone(e.status)}>{e.status}</Badge>
                {e.status === "published" ? <Button size="sm" variant="secondary" onClick={() => setStatus("equipment", e, "unpublished")}>Unpublish</Button> : <Button size="sm" onClick={() => setStatus("equipment", e, "published")}>Publish</Button>}</div>
            </div>
          ))}
        </Card>
      )}
      {tab === "analytics" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3"><Stat label="Sessions" value={stats.data?.attempts ?? 0} /><Stat label="Finished" value={stats.data?.finished ?? 0} /><Stat label="Students" value={stats.data?.students ?? 0} /></div>
          <Card><h3 className="mb-2 font-semibold">By procedure</h3>
            {(stats.data?.by_procedure ?? []).map((r: J) => <div key={r.title} className="py-1 text-sm">{r.title}: {r.attempts} finished, average {r.avg ?? "-"}%, pass rate {r.pass_rate ?? "-"}%</div>)}
            {!(stats.data?.by_procedure ?? []).length && <p className="ink-2 text-sm">No finished sessions yet.</p>}</Card>
          <Card><h3 className="mb-2 font-semibold">Most common errors</h3>
            {(stats.data?.common_errors ?? []).map((r: J, i: number) => <div key={i} className="py-1 text-sm">{r.procedure} · step {r.step ?? "(unsafe action)"}: {r.n}</div>)}
            {!(stats.data?.common_errors ?? []).length && <p className="ink-2 text-sm">No errors recorded yet.</p>}</Card>
        </div>
      )}
      {edit && <Editor row={edit} onClose={() => setEdit(null)} onSaved={list.reload} />}
    </div>
  );
}
