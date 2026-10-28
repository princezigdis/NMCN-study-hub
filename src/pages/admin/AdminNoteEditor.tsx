import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, cx, ErrorBox, Field, Input, Loading, Markdown, PageHeader, StatusBadge, Textarea, Toggle, useConfirm, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { bytes, dateShort, dateTime } from "../../lib/format";
import { Link, useParams, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import type { Note, NoteVersion } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { ContentStatus, must } from "./adminKit";

const ALLOWED_UPLOADS = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"];

export default function AdminNoteEditor() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const { confirm, confirmNode } = useConfirm();
  const note = useAsync(async () => must(await supabase.from("notes").select("*, topics(title)").eq("id", id).single()) as Note & { topics: { title: string } | null }, [id]);
  const versions = useAsync(async () => must(await supabase.from("note_versions").select("*").eq("note_id", id).order("version", { ascending: false })) as NoteVersion[], [id]);
  const refs = useAsync(async () => must(await supabase.from("note_references").select("*").eq("note_id", id).order("position")) as Array<{ id: string; citation: string; url: string | null }>, [id]);
  const files = useAsync(async () => must(await supabase.from("note_attachments").select("*").eq("note_id", id).order("created_at")) as Array<{ id: string; file_name: string; size_bytes: number; storage_path: string; downloadable: boolean; mime_type: string }>, [id]);

  const selectedId = params.get("version") ?? versions.data?.find((v) => v.status === "draft" || v.status === "rejected" || v.status === "in_review")?.id ?? versions.data?.[0]?.id;
  const version = versions.data?.find((v) => v.id === selectedId);
  const editable = !!version && (version.status === "draft" || version.status === "rejected") && can("content.manage");

  const [body, setBody] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(true);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!version) return;
    setBody(version.body_md); setSource(version.source_reference ?? ""); setSummary(version.change_summary ?? "");
    setDueDate(version.review_due_at ?? "");
  }, [version?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = version && (body !== version.body_md || source !== (version.source_reference ?? "") || summary !== (version.change_summary ?? ""));
  const wordCount = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); versions.reload(); note.reload(); } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };

  const saveDraft = () => act(async () => must(await supabase.from("note_versions").update({
    body_md: body, source_reference: source || null, change_summary: summary || null,
  }).eq("id", version!.id)), "Draft saved");

  const newVersion = () => act(async () => {
    const v = must(await supabase.from("note_versions").insert({ note_id: id, version: 0, body_md: version?.body_md ?? "", source_reference: version?.source_reference ?? null, status: "draft", change_summary: "" }).select("id").single());
    setParams({ version: v.id });
  }, "New draft version created");

  const uploadFile = async (file: File, asImage: boolean) => {
    if (!ALLOWED_UPLOADS.includes(file.type)) return toast("That file type isn't allowed", "error");
    if (file.size > 25 * 1024 * 1024) return toast("Files must be 25 MB or smaller", "error");
    const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `notes/${id}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from("content").upload(path, file, { contentType: file.type });
    if (error) return toast(friendly(error), "error");
    if (asImage) {
      const tag = `\n![${safe.replace(/\.[^.]+$/, "")}](/__storage/content/${path})\n`;
      const el = textRef.current;
      const pos = el?.selectionStart ?? body.length;
      setBody(body.slice(0, pos) + tag + body.slice(pos));
    } else {
      const res = await supabase.from("note_attachments").insert({ note_id: id, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size, downloadable: false });
      if (res.error) return toast(friendly(res.error), "error");
      files.reload();
    }
  };

  if (note.loading || versions.loading) return <Loading />;
  if (note.error || !note.data) return <ErrorBox message={note.error ?? "Note not found"} />;
  const n = note.data;

  return (
    <div>
      <Link to="/admin/curriculum" className="ink-2 mb-3 inline-flex items-center gap-1 text-sm hover:underline"><Icon name="chevronLeft" size={16} />Curriculum</Link>
      <PageHeader eyebrow={n.topics?.title} title={n.title}
        actions={<>
          <ContentStatus table="notes" id={n.id} status={n.status} onChange={note.reload} />
          {version && <a href={`/library/note/${n.id}?version=${version.id}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" icon="eye">Preview as student</Button></a>}
        </>} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {!version ? <Card><p className="text-sm">No versions yet.</p><Button className="mt-2" onClick={newVersion}>Create first draft</Button></Card> : (
            <Card>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-semibold">Version {version.version}</span><StatusBadge status={version.status} />
                {version.id === n.current_version_id && <Badge tone="success">Live</Badge>}
                <span className="ink-2 text-xs">{wordCount} words · created {dateTime(version.created_at)}</span>
                <div className="flex-1" />
                <Toggle checked={preview} onChange={setPreview} label="Preview" />
              </div>

              {editable && (
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="cursor-pointer"><span className="surface inline-flex h-8 items-center gap-1 rounded-lg border line px-3 text-sm font-semibold"><Icon name="image" size={16} />Insert image</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], true)} /></label>
                  <span className="ink-2 self-center text-xs">Markdown: ## heading, **bold**, - list, | table |, &gt; callout</span>
                </div>
              )}
              <div className={cx("grid gap-4", preview && "lg:grid-cols-2")}>
                <Textarea ref={textRef} rows={28} value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable}
                  className="font-mono text-[13px] leading-relaxed" aria-label="Note content (Markdown)" />
                {preview && <div className="surface-2 max-h-[720px] overflow-y-auto rounded-xl border line p-4"><Markdown md={body} className="prose-note" /></div>}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Source / reference for this version">{(fid) => <Input id={fid} value={source} onChange={(e) => setSource(e.target.value)} readOnly={!editable} placeholder="Textbook, guideline, author" />}</Field>
                <Field label="Change summary">{(fid) => <Input id={fid} value={summary} onChange={(e) => setSummary(e.target.value)} readOnly={!editable} placeholder="What changed and why" />}</Field>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t line pt-4">
                {editable && <Button onClick={saveDraft} loading={busy} disabled={!dirty}>Save draft</Button>}
                {editable && <Button variant="secondary" disabled={!!dirty || busy} onClick={() => act(() => rpc("admin_submit_note_version", { p_version: version.id }), "Sent for review")}>Submit for review</Button>}
                {version.status === "in_review" && can("content.review") && (
                  <>
                    <Field label="Next review date">{(fid) => <Input id={fid} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-44" />}</Field>
                    <Button className="self-end" disabled={busy} onClick={async () => {
                      if (await confirm("Approve and publish?", "This version becomes the live version students read."))
                        act(() => rpc("admin_review_note_version", { p_version: version.id, p_approve: true, p_note: null, p_review_due: dueDate || null }), "Approved and published");
                    }}>Approve & publish</Button>
                    <Button className="self-end" variant="danger" disabled={busy} onClick={() => {
                      const why = window.prompt("Reason for rejecting (sent back to the editor):");
                      if (why) act(() => rpc("admin_review_note_version", { p_version: version.id, p_approve: false, p_note: why }), "Sent back to draft");
                    }}>Reject</Button>
                  </>
                )}
                {!editable && can("content.manage") && <Button variant="secondary" onClick={newVersion} disabled={busy}>New draft from this version</Button>}
                {(version.status === "superseded" || version.status === "approved") && version.id !== n.current_version_id && can("content.manage") && (
                  <Button variant="ghost" onClick={() => act(async () => { const nid = await rpc<string>("admin_restore_note_version", { p_version: version.id }); setParams({ version: nid }); }, "Restored as a new draft")}>Restore this version</Button>
                )}
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <NoteSettings note={n} onSaved={note.reload} />
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Version history</h3>
            <ul className="space-y-1">
              {versions.data?.map((v) => (
                <li key={v.id}>
                  <button onClick={() => setParams({ version: v.id })} className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm", v.id === selectedId ? "bg-brand-50 dark:bg-brand-900/40" : "hover:bg-[var(--surface-2)]")}>
                    <span className="font-medium">v{v.version}</span><StatusBadge status={v.status} />
                    {v.id === n.current_version_id && <Badge tone="success">live</Badge>}
                    <span className="ink-2 ml-auto text-xs">{dateShort(v.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-semibold">References</h3>
            <ul className="mb-2 space-y-1 text-sm">
              {refs.data?.map((r) => (
                <li key={r.id} className="flex gap-2"><span className="flex-1">{r.citation}</span>
                  <button className="text-xs text-red-600" onClick={async () => { await supabase.from("note_references").delete().eq("id", r.id); refs.reload(); }}>Remove</button></li>
              ))}
            </ul>
            <Button size="sm" variant="secondary" icon="plus" onClick={async () => {
              const citation = window.prompt("Citation (author, title, year, edition/page):");
              if (!citation) return;
              const url = window.prompt("Link (optional, https://…)") || null;
              const res = await supabase.from("note_references").insert({ note_id: id, citation, url: url && /^https?:\/\//.test(url) ? url : null, position: (refs.data?.length ?? 0) + 1 });
              if (res.error) toast(friendly(res.error), "error"); else refs.reload();
            }}>Add reference</Button>
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Attachments</h3>
            <ul className="mb-2 space-y-2 text-sm">
              {files.data?.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{f.file_name} <span className="ink-2">({bytes(f.size_bytes)})</span></span>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.downloadable} onChange={async (e) => { await supabase.from("note_attachments").update({ downloadable: e.target.checked }).eq("id", f.id); files.reload(); }} />download</label>
                  <button className="text-xs text-red-600" onClick={async () => { await supabase.storage.from("content").remove([f.storage_path]); await supabase.from("note_attachments").delete().eq("id", f.id); files.reload(); }}>Remove</button>
                </li>
              ))}
            </ul>
            <label className="cursor-pointer text-sm font-semibold text-brand-700 underline dark:text-brand-300">Upload file (PDF, DOCX, PPTX, image)
              <input type="file" className="hidden" accept={ALLOWED_UPLOADS.join(",")} onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], false)} /></label>
            <p className="ink-2 mt-2 text-xs">Only upload material you own or are licensed to share.</p>
          </Card>
        </aside>
      </div>
      {confirmNode}
    </div>
  );
}

function NoteSettings({ note, onSaved }: { note: Note; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(note.title);
  const [kind, setKind] = useState(note.kind);
  const [downloadable, setDownloadable] = useState(note.downloadable);
  const [demo, setDemo] = useState(note.is_demo);
  const save = async () => {
    const { error } = await supabase.from("notes").update({ title, kind, downloadable, is_demo: demo }).eq("id", note.id);
    if (error) toast(friendly(error), "error"); else { toast("Saved"); onSaved(); }
  };
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Note settings</h3>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <select className="surface w-full rounded-lg border line px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as Note["kind"])} aria-label="Type">
        <option value="note">Study note</option><option value="handout">Handout</option>
      </select>
      <Toggle checked={downloadable} onChange={setDownloadable} label="Allow attachment downloads" />
      <Toggle checked={demo} onChange={setDemo} label="Demonstration content" />
      <Button size="sm" onClick={save}>Save settings</Button>
    </Card>
  );
}
