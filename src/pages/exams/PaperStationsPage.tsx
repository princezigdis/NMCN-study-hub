import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Loading, PageHeader, useToast } from "../../components/ui";
import { caosce, viva } from "../../lib/lab";
import { friendly } from "../../lib/errors";
import { api } from "../../lib/api";
import { Link, useNavigate, useParams } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";

function ExamStart() {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const open = useAsync(async () => {
    const [v, c] = await Promise.all([viva.home().catch(() => null), caosce.home().catch(() => null)]);
    return {
      viva: v?.recent?.find((r: { status: string; mode: string; id: string }) => r.status === "in_progress" && r.mode === "mock")?.id as string | undefined,
      caosce: c?.recent?.find((r: { status: string; id: string }) => r.status === "in_progress")?.id as string | undefined,
    };
  }, []);
  const go = async (key: string, fn: () => Promise<string>, path: string) => {
    setBusy(key);
    try { nav(`${path}/${await fn()}`); } catch (e) { toast(friendly(e), "error"); } finally { setBusy(""); }
  };
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <Icon name="mic" className="mb-2 text-brand-600" />
        <h2 className="font-semibold">Viva examination</h2>
        <p className="ink-2 mt-1 text-sm">When you press start, the examiner gives you a random case and asks the questions one at a time. You cannot choose the topic or the questions. Answer by voice or typing. Your result and the marking guide appear at the end.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {open.data?.viva && <Link to={`/viva/session/${open.data.viva}`}><Button variant="accent">Resume viva</Button></Link>}
          <Button loading={busy === "viva"} onClick={() => go("viva", () => viva.start({ mode: "mock", count: 2, style: "professional" }), "/viva/session")}>Start viva</Button>
        </div>
      </Card>
      <Card>
        <Icon name="activity" className="mb-2 text-brand-600" />
        <h2 className="font-semibold">CAOSCE examination</h2>
        <p className="ink-2 mt-1 text-sm">When you press start, you are given random procedure stations and a question station, each with its own timer. You cannot choose the procedure. Write out what you would do, step by step. Your marked checklist appears at the end.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {open.data?.caosce && <Link to={`/caosce/exam/${open.data.caosce}`}><Button variant="accent">Resume CAOSCE</Button></Link>}
          <Button loading={busy === "caosce"} onClick={() => go("caosce", () => caosce.examStartRandom(), "/caosce/exam")}>Start CAOSCE</Button>
        </div>
      </Card>
    </div>
  );
}

export default function PaperStationsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => api.paperStations(id), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Paper 4" title="Viva & CAOSCE"
        subtitle="Work through each station as if an examiner were present, then compare your answers with the marking guide." />
      <ExamStart />
      {data?.length ? <h2 className="mb-3 font-semibold">Practice stations</h2> : null}
      {!data?.length ? <EmptyState icon="clipboard" title="No stations yet">Stations for this paper are being prepared.</EmptyState> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.map((s) => (
            <Link key={s.id} to={`/station/${s.id}`}>
              <Card className="h-full hover:border-brand-400">
                <div className="flex items-center gap-2">
                  <Badge tone="brand">{s.kind === "viva" ? "Viva" : "CAOSCE"}</Badge>
                  {s.is_demo && <DemoBadge />}
                </div>
                <div className="mt-2 font-semibold">{s.title}</div>
                <div className="ink-2 mt-1 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1"><Icon name="clock" size={14} />{s.duration_minutes} min</span>
                  {s.attempts > 0 && <span>{s.attempts} attempt{s.attempts > 1 ? "s" : ""}</span>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
