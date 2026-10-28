import { useEffect, useMemo, useRef, useState } from "react";
import { api, newIdempotencyKey } from "../../lib/api";
import { friendly, toAppError } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import type { AiResponse } from "../../lib/types";
import { Link } from "../../lib/router";
import { Icon } from "../Icon";
import { ReportDialog } from "../ReportDialog";
import { Badge, Button, cx, Input, Markdown, Spinner, Textarea, useConfirm, useToast } from "../ui";
import { type AssistRequest, useAI } from "./AIContext";

const ACTIONS_BY_KIND: Record<AssistRequest["kind"], string[]> = {
  note: ["explain_simple", "explain_exam", "summarize", "expand_notes", "differentiate", "flashcards", "mnemonic",
    "practice_questions", "diagram", "video_search", "web_search"],
  general: ["explain_simple", "explain_exam", "summarize", "differentiate", "flashcards", "mnemonic", "diagram", "video_search", "web_search"],
  question: ["rationale_expand", "explain_simple", "explain_exam", "mnemonic", "flashcards", "diagram", "video_search"],
  station: ["viva_feedback"],
};
const CONFIRM_AT = 5; // credits — ask before spending this many

interface Entry { id: string; action: string; label: string; status: "loading" | "done" | "error"; response?: AiResponse; error?: string; key: string }

export function AIAssistPanel({ request, onClose }: { request: AssistRequest; onClose: () => void }) {
  const { costs, wallet, setWalletBalance, refreshWallet, enabled } = useAI();
  const toast = useToast();
  const { confirm, confirmNode } = useConfirm();
  const [text, setText] = useState(request.text);
  const [followUp, setFollowUp] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const started = useRef(false);

  const available = useMemo(() => {
    const allowed = ACTIONS_BY_KIND[request.kind];
    return allowed.map((a) => costs.find((c) => c.action === a)).filter(Boolean) as typeof costs;
  }, [costs, request.kind]);
  const followCost = costs.find((c) => c.action === "follow_up");

  const run = async (action: string, extra?: { followUp?: string }) => {
    const cost = costs.find((c) => c.action === action);
    if (!cost) return;
    if (cost.credits >= CONFIRM_AT) {
      const ok = await confirm(`Use ${cost.credits} credits?`,
        <>“{cost.label}” costs <b>{cost.credits} credits</b>. You have {wallet?.balance ?? "—"} credits. Failed requests are refunded automatically.</>,
        { confirmLabel: `Use ${cost.credits} credits` });
      if (!ok) return;
    }
    const key = newIdempotencyKey();
    const id = key;
    setEntries((e) => [{ id, key, action, label: extra?.followUp ? `Follow-up: ${extra.followUp}` : cost.label, status: "loading" }, ...e]);
    try {
      const res = await api.ai({
        action, text, idempotencyKey: key, noteId: request.noteId, topicId: request.topicId ?? undefined,
        questionId: request.questionId, stationAttemptId: request.stationAttemptId, followUp: extra?.followUp,
      });
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, status: "done", response: res } : x)));
      if (typeof res.balance === "number") setWalletBalance(res.balance);
    } catch (err) {
      const ae = toAppError(err);
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, status: "error", error: ae.message } : x)));
      if (typeof ae.extra?.balance === "number") setWalletBalance(ae.extra.balance as number);
      else refreshWallet();
    }
  };

  useEffect(() => {
    if (request.action && !started.current && costs.length) {
      started.current = true;
      run(request.action);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.action, costs.length]);

  const saveCards = async (cards: Array<{ front: string; back: string }>) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("flashcards").insert(cards.map((c) => ({
      user_id: u.user?.id, front: c.front, back: c.back, source: "ai", note_id: request.noteId ?? null,
      deck: request.title?.slice(0, 80) || "AI cards",
    })));
    if (error) toast(friendly(error), "error");
    else toast(`${cards.length} flashcards saved to your deck`);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()} aria-label="AI study assistant"
        className="surface flex h-full w-full max-w-xl flex-col shadow-2xl sm:rounded-l-2xl">
        <header className="flex items-center justify-between border-b line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-accent-400/20 p-1.5 text-accent-600"><Icon name="sparkles" size={18} /></span>
            <div>
              <div className="font-semibold">AI study assistant</div>
              <div className="ink-2 text-xs">
                {wallet ? <>{wallet.balance} credits left · {wallet.plan_name} plan · <Link to="/plans" className="underline" onClick={onClose}>upgrade</Link></> : "Loading credits…"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--surface-2)]" aria-label="Close assistant"><Icon name="x" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!enabled ? (
            <p className="ink-2 text-sm">The AI assistant is turned off at the moment.</p>
          ) : (
            <>
              {request.kind !== "station" && (
                <div className="mb-3">
                  <label className="ink-2 mb-1 block text-xs font-medium uppercase tracking-wide" htmlFor="ai-sel">Selected text</label>
                  <Textarea id="ai-sel" rows={4} value={text} onChange={(e) => setText(e.target.value)} className="text-[13px]" maxLength={12000} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {available.map((c) => (
                  <button key={c.action} onClick={() => run(c.action)} disabled={!text.trim() && !["rationale_expand", "viva_feedback"].includes(c.action)}
                    className="surface-2 flex items-center justify-between gap-2 rounded-xl border line px-3 py-2 text-left text-sm font-medium hover:border-brand-400 disabled:opacity-50">
                    <span>{c.label}</span>
                    <span className="shrink-0 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">{c.credits} cr</span>
                  </button>
                ))}
              </div>

              {request.kind !== "station" && followCost && (
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (followUp.trim()) { run("follow_up", { followUp }); setFollowUp(""); } }}>
                  <Input placeholder="Ask a follow-up question…" value={followUp} onChange={(e) => setFollowUp(e.target.value)} maxLength={1000} />
                  <Button type="submit" disabled={!followUp.trim()}>Ask · {followCost.credits} cr</Button>
                </form>
              )}

              <div className="mt-5 space-y-4">
                {entries.map((en) => (
                  <ResultCard key={en.id} entry={en} onSaveCards={saveCards} onReport={() => setReport(en.response?.requestId ?? null)} />
                ))}
              </div>
            </>
          )}
        </div>
        <footer className="ink-2 border-t line px-4 py-2 text-[11px] leading-snug">
          AI answers can be wrong. Always check them against your approved notes. Don't enter personal or patient information.
        </footer>
      </aside>
      {confirmNode}
      {report !== null && (
        <ReportDialog open onClose={() => setReport(null)} targetType="ai_response" targetId={report || null} context={text} />
      )}
    </div>
  );
}

function ResultCard({ entry, onSaveCards, onReport }: {
  entry: Entry; onSaveCards: (c: Array<{ front: string; back: string }>) => void; onReport: () => void;
}) {
  const r = entry.response;
  return (
    <div className="rounded-2xl border line p-4" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{entry.label}</div>
        {entry.status === "done" && <Badge tone="warning"><Icon name="sparkles" size={12} />AI-generated</Badge>}
      </div>
      {entry.status === "loading" && <div className="ink-2 flex items-center gap-2 text-sm"><Spinner size={16} /> Thinking…</div>}
      {entry.status === "error" && <p className="text-sm text-red-600">{entry.error}</p>}
      {r && (
        <>
          {r.data?.imageUrl && (
            <figure className="mb-3">
              <img src={r.data.imageUrl} alt="AI-generated educational diagram" className="w-full rounded-xl border line" />
              <figcaption className="ink-2 mt-1 text-xs">Check every label against your notes. <a className="underline" href={r.data.imageUrl} download target="_blank" rel="noreferrer">Download</a></figcaption>
            </figure>
          )}
          {r.data?.videos && (
            <ul className="mb-3 space-y-2">
              {r.data.videos.map((v) => (
                <li key={v.videoId}>
                  <a href={v.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-xl p-1 hover:bg-[var(--surface-2)]">
                    {v.thumbnail && <img src={v.thumbnail} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" loading="lazy" />}
                    <span className="min-w-0"><span className="line-clamp-2 text-sm font-medium">{v.title}</span><span className="ink-2 block text-xs">{v.channel}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {r.data?.questions ? <GeneratedQuiz questions={r.data.questions} /> : <Markdown md={r.output} />}
          {r.data?.cards && (
            <Button size="sm" variant="secondary" icon="cards" className="mt-2" onClick={() => onSaveCards(r.data!.cards!)}>
              Save {r.data.cards.length} cards to my deck
            </Button>
          )}
          {!!r.citations?.length && (
            <div className="mt-3 border-t line pt-2 text-xs">
              <div className="ink-2 mb-1 font-semibold">Sources</div>
              <ol className="list-decimal space-y-0.5 pl-4">
                {r.citations.map((c, i) => (
                  <li key={i}>
                    {c.type === "note" && c.id ? <Link to={`/library/note/${c.id}`} className="underline">{c.title}</Link>
                      : c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline">{c.title}</a> : c.title}
                    {c.type === "note" && <span className="ink-2"> (approved notes)</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="ink-2 mt-3 flex items-center justify-between text-xs">
            <span>{r.creditsCharged ? `${r.creditsCharged} credits used` : ""}</span>
            <button onClick={onReport} className="inline-flex items-center gap-1 underline"><Icon name="flag" size={12} />Report an error</button>
          </div>
        </>
      )}
    </div>
  );
}

function GeneratedQuiz({ questions }: { questions: NonNullable<NonNullable<AiResponse["data"]>["questions"]> }) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Unverified AI practice questions — not part of the reviewed question bank.
      </p>
      {questions.map((q, i) => {
        const choice = picked[i];
        return (
          <div key={i}>
            <p className="mb-2 text-sm font-medium">{i + 1}. {q.stem}</p>
            <div className="space-y-1">
              {(["A", "B", "C", "D"] as const).map((l) => (
                <button key={l} disabled={!!choice} onClick={() => setPicked((p) => ({ ...p, [i]: l }))}
                  className={cx("w-full rounded-lg border px-3 py-1.5 text-left text-sm",
                    choice && l === q.answer ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" :
                      choice === l ? "border-red-500 bg-red-50 dark:bg-red-950/40" : "line hover:bg-[var(--surface-2)]")}>
                  <b>{l}.</b> {q.options[l]}
                </button>
              ))}
            </div>
            {choice && (
              <div className="mt-2 text-xs">
                <p><b>Answer {q.answer}:</b> {q.rationale}</p>
                {Object.entries(q.distractors ?? {}).map(([l, why]) => <p key={l} className="ink-2"><b>{l}:</b> {why}</p>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
