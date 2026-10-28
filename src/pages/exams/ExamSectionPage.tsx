import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Paywall } from "../../components/Paywall";
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorBox, Loading, Markdown, Modal, PageHeader, StatusBadge, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { dateShort, dateTime, pct } from "../../lib/format";
import { Link, useNavigate } from "../../lib/router";
import type { ExamCatalogue, ExamPaperSummary } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

const COPY = {
  C: {
    eyebrow: "Section C", title: "Mock Examination",
    subtitle: "Timed practice in the Papers 1–4 format: objective papers plus viva and CAOSCE-style stations.",
    features: [
      "Papers 1–3: timed objective papers with automatic marking",
      "Paper 4: viva and CAOSCE-style practice stations with marking guides",
      "Results by topic and full answer review with rationales",
      "Resume if your connection drops; the timer is kept on the server",
    ],
  },
  D: {
    eyebrow: "Section D", title: "Final Examination Simulator",
    subtitle: "Full-length final-exam simulations with their own question pools, separate from Section C.",
    features: [
      "Separate question pools from Section C (no repeats from the mock)",
      "Full-length timed papers with server-side scoring",
      "Weak-topic analysis and a readiness indicator from your results",
      "Viva and CAOSCE-style practice where configured",
    ],
  },
} as const;

export default function ExamSectionPage({ section }: { section: "C" | "D" }) {
  const copy = COPY[section];
  const { data, error, loading, reload } = useAsync(() => api.examCatalogue(section), [section]);
  const [paper, setPaper] = useState<{ p: ExamPaperSummary; instructions: string | null; config: string } | null>(null);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />
      {!data.has_access ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_340px]">
          <Card>
            <h2 className="font-semibold">What's included</h2>
            <p className="ink-2 mt-2 text-sm">These are practice simulations designed around the published examination structure. They are not official NMCN examinations, and your scores here don't guarantee any result in the real exam.</p>
            {section === "D" && <p className="ink-2 mt-2 text-sm">Section D is a separate purchase from Section C.</p>}
          </Card>
          <Paywall product={data.product} features={[...copy.features]} />
        </div>
      ) : (
        <div className="space-y-6">
          {data.entitlement && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <Icon name="checkCircle" size={18} /> Unlocked{data.entitlement.expires_at ? ` until ${dateShort(data.entitlement.expires_at)}` : ""}.
            </div>
          )}
          {section === "D" && <Readiness history={data.history} />}
          {!data.configs.length && <EmptyState icon="clipboard" title="No exams published yet">Check back soon; your administrators are preparing them.</EmptyState>}
          {data.configs.map((c) => (
            <Card key={c.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{c.title}</h2>
                {c.is_demo && <DemoBadge />}
                {c.programme && <Badge tone="brand">{c.programme}</Badge>}
              </div>
              {c.description && <p className="ink-2 mb-4 text-sm">{c.description}</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {c.papers.map((p) => (
                  <div key={p.id} className="surface-2 rounded-xl border line p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">Paper {p.paper_number}</span>
                      {p.best_percent !== null && <span className="ink-2 text-xs">Best {pct(p.best_percent)}</span>}
                    </div>
                    <div className="mt-1 font-semibold">{p.title}</div>
                    <div className="ink-2 mt-1 text-xs">
                      {p.kind === "objective" ? `${p.question_count} questions · ${p.duration_minutes} min` : `${p.station_count} station${p.station_count === 1 ? "" : "s"} · ${p.kind === "viva" ? "Viva" : "CAOSCE"} practice`}
                      {c.max_attempts ? ` · ${p.attempts_used}/${c.max_attempts} attempts` : ""}
                    </div>
                    <div className="mt-3">
                      {p.kind === "objective" ? (
                        <Button size="sm" onClick={() => setPaper({ p, instructions: c.instructions, config: c.title })}
                          disabled={!!c.max_attempts && p.attempts_used >= c.max_attempts && !p.open_attempt_id}>
                          {p.open_attempt_id ? "Resume" : "Start"}
                        </Button>
                      ) : (
                        <Link to={`/paper/${p.id}/stations`}><Button size="sm" variant="secondary">Open stations</Button></Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <History history={data.history} />
        </div>
      )}
      {paper && <StartModal paper={paper.p} instructions={paper.instructions} configTitle={paper.config} onClose={() => setPaper(null)} />}
    </div>
  );
}

function StartModal({ paper, instructions, configTitle, onClose }: { paper: ExamPaperSummary; instructions: string | null; configTitle: string; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const r = await api.examStart(paper.id);
      navigate(`/exam/${r.attempt_id}`);
    } catch (e) {
      toast(friendly(e), "error");
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${configTitle} · Paper ${paper.paper_number}`}
      footer={<><Button variant="secondary" onClick={onClose}>Not now</Button><Button onClick={start} loading={busy}>{paper.open_attempt_id ? "Resume exam" : "Begin exam"}</Button></>}>
      <ul className="mb-4 space-y-2 text-sm">
        <li className="flex gap-2"><Icon name="clock" size={18} className="text-brand-600" />{paper.duration_minutes} minutes for {paper.question_count} questions.</li>
        <li className="flex gap-2"><Icon name="refresh" size={18} className="text-brand-600" />Answers save automatically. If you lose connection, come back and resume.</li>
        <li className="flex gap-2"><Icon name="alert" size={18} className="text-accent-600" />The timer runs on the server and keeps going if you leave. At zero, the paper is submitted automatically.</li>
      </ul>
      {instructions && <div className="surface-2 rounded-xl p-3"><Markdown md={instructions} /></div>}
    </Modal>
  );
}

function History({ history }: { history: ExamCatalogue["history"] }) {
  if (!history.length) return null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Attempt history</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="ink-2 text-left text-xs uppercase"><tr><th className="py-2">Paper</th><th>Date</th><th>Status</th><th className="text-right">Score</th><th /></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t line">
                <td className="py-2">{h.config} · P{h.paper_number}</td>
                <td>{dateTime(h.started_at)}</td>
                <td><StatusBadge status={h.status} /></td>
                <td className="text-right font-semibold">{h.status === "in_progress" ? "—" : `${h.score}/${h.total} (${pct(h.percent)})`}</td>
                <td className="text-right">{h.status === "in_progress" ? <Link to={`/exam/${h.id}`} className="text-brand-700 underline">Resume</Link> : <Link to={`/exam/${h.id}/review`} className="text-brand-700 underline dark:text-brand-300">Review</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Readiness({ history }: { history: ExamCatalogue["history"] }) {
  const done = history.filter((h) => h.status !== "in_progress" && h.percent !== null).slice(0, 3);
  if (!done.length) return null;
  const avg = done.reduce((s, h) => s + Number(h.percent), 0) / done.length;
  const label = avg >= 70 ? "On track in practice" : avg >= 50 ? "Developing" : "Needs more practice";
  return (
    <Card className="border-brand-200 bg-brand-50/60 dark:bg-brand-900/30">
      <div className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Readiness indicator</div>
      <div className="mt-1 text-xl font-bold">{label} · {pct(avg)}</div>
      <p className="ink-2 mt-1 text-xs">Average of your last {done.length} Section D attempt{done.length > 1 ? "s" : ""}. This reflects practice performance only and doesn't predict or guarantee a result in the actual examination.</p>
    </Card>
  );
}
