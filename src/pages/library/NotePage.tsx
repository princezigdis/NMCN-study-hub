import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAI } from "../../components/ai/AIContext";
import { SelectionAssist } from "../../components/ai/SelectionAssist";
import { Icon } from "../../components/Icon";
import { ReportDialog } from "../../components/ReportDialog";
import { Badge, Button, Card, DemoBadge, ErrorBox, Loading, Textarea, useToast } from "../../components/ui";
import { api, signedUrl } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { bytes, dateShort } from "../../lib/format";
import { renderMarkdown, resolveStorageImages } from "../../lib/markdown";
import { Link, useParams, useSearchParams } from "../../lib/router";
import { supabase } from "../../lib/supabase";
import { useAsync } from "../../lib/useAsync";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const preview = params.get("version") ?? undefined;
  const { open } = useAI();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useAsync(() => api.noteReader(id, preview), [id, preview]);
  const [report, setReport] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const maxPct = useRef(0);

  // Reading progress: track the furthest point scrolled, saved at most every few seconds.
  useEffect(() => {
    if (!data || data.version.is_preview) return;
    maxPct.current = data.progress ?? 0;
    let last = maxPct.current;
    const onScroll = () => {
      const el = bodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const seen = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / Math.max(rect.height, 1)));
      maxPct.current = Math.max(maxPct.current, Math.round(seen * 100));
    };
    const timer = setInterval(() => {
      if (maxPct.current > last) { last = maxPct.current; api.noteProgress(id, last).catch(() => undefined); }
    }, 4000);
    api.noteProgress(id, Math.max(last, 1)).catch(() => undefined);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearInterval(timer);
      if (maxPct.current > last) api.noteProgress(id, maxPct.current).catch(() => undefined);
    };
  }, [data?.version.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => (data ? markHighlights(renderMarkdown(data.version.body_md), data.highlights.map((h) => h.quote)) : ""), [data]);
  useEffect(() => { if (bodyRef.current) resolveStorageImages(bodyRef.current); }, [html]);

  const toggleBookmark = async () => {
    if (!data) return;
    if (data.bookmarked) {
      await supabase.from("bookmarks").delete().eq("note_id", id);
    } else {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("bookmarks").insert({ user_id: u.user?.id, note_id: id });
      if (error) return toast(friendly(error), "error");
    }
    setData({ ...data, bookmarked: !data.bookmarked });
  };

  const addHighlight = async (quote: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { data: row, error } = await supabase.from("highlights").insert({ user_id: u.user?.id, note_id: id, quote: quote.slice(0, 4000) })
      .select("id, quote, color, comment").single();
    if (error || !row || !data) return toast(friendly(error), "error");
    setData({ ...data, highlights: [...data.highlights, row] });
  };

  const removeHighlight = async (hid: string) => {
    await supabase.from("highlights").delete().eq("id", hid);
    if (data) setData({ ...data, highlights: data.highlights.filter((h) => h.id !== hid) });
  };

  const ask = useCallback((text: string) => {
    if (!data) return;
    open({ kind: "note", text, noteId: data.note.id, topicId: data.breadcrumb?.topic_id, title: data.note.title });
  }, [data, open]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Note not found"} onRetry={reload} />;
  const b = data.breadcrumb;

  return (
    <div className="mx-auto max-w-3xl">
      {b && (
        <nav className="ink-2 mb-3 flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
          <Link to="/library" className="hover:underline">Library</Link><Icon name="chevronRight" size={14} />
          <Link to={`/library/course/${b.course_id}`} className="hover:underline">{b.course_code}</Link><Icon name="chevronRight" size={14} />
          <span>{b.module}</span><Icon name="chevronRight" size={14} /><span>{b.topic}</span>
        </nav>
      )}

      {data.version.is_preview && (
        <div className="mb-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
          Admin preview of version {data.version.version} ({data.version.status}). Students can't see this version yet.
        </div>
      )}

      <header className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {data.note.kind === "handout" && <Badge tone="brand">Handout</Badge>}
          {data.note.is_demo && <DemoBadge />}
        </div>
        <h1 className="text-3xl font-bold leading-tight">{data.note.title}</h1>
        <div className="ink-2 mt-2 text-xs">
          Version {data.version.version}
          {data.version.reviewed_at && <> · Reviewed {dateShort(data.version.reviewed_at)}</>}
          {data.version.review_due_at && <> · Next review {dateShort(data.version.review_due_at)}</>}
        </div>
      </header>

      <div className="surface sticky top-14 z-10 -mx-4 mb-4 flex gap-2 overflow-x-auto border-y line px-4 py-2 sm:mx-0 sm:rounded-xl sm:border">
        <Button size="sm" variant="accent" icon="sparkles" onClick={() => ask(`${data.note.title}\n\n${data.version.body_md.slice(0, 6000)}`)}>AI tools</Button>
        <Button size="sm" variant="secondary" icon="bookmark" onClick={toggleBookmark} aria-pressed={data.bookmarked}>{data.bookmarked ? "Saved" : "Save"}</Button>
        {data.related_question_count > 0 && b && (
          <Link to={`/practice?topic=${b.topic_id}`}><Button size="sm" variant="secondary" icon="quiz">Practise {data.related_question_count} questions</Button></Link>
        )}
        <Button size="sm" variant="ghost" icon="flag" onClick={() => setReport(true)}>Report</Button>
      </div>

      <p className="ink-2 mb-4 text-xs">Tip: select any sentence to explain, summarise, compare, or turn it into flashcards.</p>

      <Card className="sm:p-8">
        <SelectionAssist onAsk={ask} onHighlight={addHighlight}>
          <div ref={bodyRef} className="prose-note" dangerouslySetInnerHTML={{ __html: html }} />
        </SelectionAssist>
      </Card>

      {(data.version.source_reference || data.references.length > 0) && (
        <Card className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">References</h2>
          {data.version.source_reference && <p className="ink-2 text-sm">{data.version.source_reference}</p>}
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {data.references.map((r, i) => <li key={i}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">{r.citation}</a> : r.citation}</li>)}
          </ol>
        </Card>
      )}

      {data.attachments.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">Attachments</h2>
          <ul className="space-y-2">
            {data.attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{a.file_name} <span className="ink-2">({bytes(a.size_bytes)})</span></span>
                {a.downloadable ? (
                  <Button size="sm" variant="secondary" icon="download" onClick={async () => {
                    const url = await signedUrl("content", a.storage_path, 300);
                    if (url) window.open(url, "_blank", "noopener");
                  }}>Download</Button>
                ) : <span className="ink-2 text-xs">View only</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.highlights.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">My highlights</h2>
          <ul className="space-y-2">
            {data.highlights.map((h) => (
              <li key={h.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-accent-400" />
                <span className="flex-1">{h.quote}</span>
                <button onClick={() => ask(h.quote)} className="text-xs text-brand-700 underline dark:text-brand-300">Ask AI</button>
                <button onClick={() => removeHighlight(h.id)} aria-label="Remove highlight" className="ink-2"><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PersonalNote noteId={id} topicId={b?.topic_id ?? null} title={data.note.title} />
      <ReportDialog open={report} onClose={() => setReport(false)} targetType="note" targetId={id} />
    </div>
  );
}

function PersonalNote({ noteId, topicId, title }: { noteId: string; topicId: string | null; title: string }) {
  const toast = useToast();
  const [rowId, setRowId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("personal_notes").select("id, body").eq("note_id", noteId).order("updated_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data) { setRowId(data.id); setBody(data.body); } });
  }, [noteId]);
  const save = async () => {
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const res = rowId
      ? await supabase.from("personal_notes").update({ body }).eq("id", rowId).select("id").single()
      : await supabase.from("personal_notes").insert({ user_id: u.user?.id, note_id: noteId, topic_id: topicId, title, body }).select("id").single();
    setBusy(false);
    if (res.error) return toast(friendly(res.error), "error");
    setRowId(res.data.id);
    toast("Your note is saved");
  };
  return (
    <Card className="mt-4">
      <h2 className="mb-2 text-sm font-semibold">My notes on this topic</h2>
      <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your own summary, mnemonics or questions…" maxLength={50000} />
      <div className="mt-2 flex justify-end"><Button size="sm" onClick={save} loading={busy}>Save note</Button></div>
    </Card>
  );
}

/** Wrap saved highlight quotes in <mark> (matches within a single text node). */
function markHighlights(html: string, quotes: string[]): string {
  if (!quotes.length || typeof document === "undefined") return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const q of quotes) {
    const needle = q.trim();
    if (needle.length < 3) continue;
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue ?? "";
      const idx = text.indexOf(needle);
      if (idx >= 0 && node.parentNode && (node.parentNode as Element).tagName !== "MARK") {
        const before = document.createTextNode(text.slice(0, idx));
        const mark = document.createElement("mark");
        mark.textContent = needle;
        const after = document.createTextNode(text.slice(idx + needle.length));
        node.parentNode.replaceChild(after, node);
        after.parentNode!.insertBefore(mark, after);
        after.parentNode!.insertBefore(before, mark);
        break;
      }
    }
  }
  return tpl.innerHTML;
}
