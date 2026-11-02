import { useState } from "react";
import { Button, Card, EmptyState, Input, PageHeader, Spinner, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";

type Video = { videoId: string; title: string; channel: string; thumbnail: string; url: string };
const SUGGESTIONS = ["Handwashing technique", "Urinary catheterisation", "Measuring blood pressure", "Wound dressing", "Normal vaginal delivery", "Newborn resuscitation", "Intravenous cannulation", "Abdominal palpation"];

export default function VideosPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [current, setCurrent] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (term: string) => {
    const query = term.trim();
    if (query.length < 3) return toast("Type a procedure name", "error");
    setBusy(true);
    try {
      const r = await api.videoSearch(query);
      setVideos(r.videos);
      setCurrent(r.videos[0] ?? null);
    } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Procedure videos" subtitle="Watch nursing and midwifery procedures without leaving the app. Results are limited to clinical content." />
      <form onSubmit={(e) => { e.preventDefault(); void search(q); }} className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. urinary catheterisation" maxLength={120} aria-label="Search procedure videos" />
        <Button type="submit" loading={busy}>Search</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => { setQ(s); void search(s); }} className="rounded-full border line px-3 py-1 text-xs hover:bg-[var(--surface-2)]">{s}</button>
        ))}
      </div>
      {busy && <div className="flex justify-center py-8"><Spinner size={28} /></div>}
      {current && !busy && (
        <Card className="space-y-3 p-3">
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe key={current.videoId} className="h-full w-full" title={current.title}
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(current.videoId)}?rel=0&modestbranding=1`}
              allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          </div>
          <div><div className="font-semibold">{current.title}</div><div className="ink-2 text-xs">{current.channel}</div></div>
        </Card>
      )}
      {videos && videos.length === 0 && !busy && <EmptyState icon="video" title="No clinical videos found">Try a more specific procedure name.</EmptyState>}
      {videos && videos.length > 1 && !busy && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {videos.map((v) => (
            <button key={v.videoId} onClick={() => setCurrent(v)} className="surface flex gap-3 rounded-xl border line p-2 text-left hover:border-brand-300">
              {v.thumbnail && <img src={v.thumbnail} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" loading="lazy" />}
              <span className="min-w-0 text-sm"><span className="line-clamp-2 font-medium">{v.title}</span><span className="ink-2 block truncate text-xs">{v.channel}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
