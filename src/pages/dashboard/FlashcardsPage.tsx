import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast } from "../../components/ui";
import { friendly } from "../../lib/errors";
import { relative } from "../../lib/format";
import { GRADES, review } from "../../lib/srs";
import { supabase } from "../../lib/supabase";
import type { Flashcard } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

export default function FlashcardsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<"review" | "all">("review");
  const [deck, setDeck] = useState("");
  const [editing, setEditing] = useState<Partial<Flashcard> | null>(null);
  const cards = useAsync(async () => {
    const { data, error } = await supabase.from("flashcards").select("*").order("due_at");
    if (error) throw error;
    return data as Flashcard[];
  }, []);

  const decks = useMemo(() => [...new Set((cards.data ?? []).map((c) => c.deck))].sort(), [cards.data]);
  const inDeck = (cards.data ?? []).filter((c) => !deck || c.deck === deck);
  const due = inDeck.filter((c) => new Date(c.due_at) <= new Date());

  const save = async () => {
    if (!editing?.front?.trim() || !editing.back?.trim()) return toast("Front and back are required", "error");
    const { data: u } = await supabase.auth.getUser();
    const payload = { front: editing.front.trim(), back: editing.back.trim(), deck: editing.deck?.trim() || "General" };
    const res = editing.id
      ? await supabase.from("flashcards").update(payload).eq("id", editing.id)
      : await supabase.from("flashcards").insert({ ...payload, user_id: u.user?.id, source: "manual" });
    if (res.error) return toast(friendly(res.error), "error");
    setEditing(null);
    cards.reload();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Section E" title="Flashcards" subtitle="Spaced repetition: cards come back just before you'd forget them."
        actions={<Button icon="plus" onClick={() => setEditing({ deck: deck || "General" })}>New card</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "review", label: `Review (${due.length})` }, { id: "all", label: `All cards (${inDeck.length})` }]} />
        <Select value={deck} onChange={(e) => setDeck(e.target.value)} className="w-auto" aria-label="Deck">
          <option value="">All decks</option>
          {decks.map((d) => <option key={d}>{d}</option>)}
        </Select>
      </div>
      {cards.loading && <Loading />}
      {cards.error && <ErrorBox message={cards.error} onRetry={cards.reload} />}
      {cards.data && tab === "review" && <Reviewer cards={due} onDone={cards.reload} />}
      {cards.data && tab === "all" && (
        !inDeck.length ? <EmptyState icon="cards" title="No cards yet">Create cards here, or select text in a note and choose “Make flashcards”.</EmptyState> : (
          <div className="space-y-2">
            {inDeck.map((c) => (
              <Card key={c.id} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{c.front}</div>
                  <div className="ink-2 mt-1 text-sm">{c.back}</div>
                  <div className="ink-2 mt-2 flex gap-2 text-xs"><Badge>{c.deck}</Badge>{c.source === "ai" && <Badge tone="warning">AI</Badge>}<span>Due {relative(c.due_at) || "now"}</span></div>
                </div>
                <button className="ink-2 text-xs underline" onClick={() => setEditing(c)}>Edit</button>
                <button className="text-xs text-red-600 underline" onClick={async () => { await supabase.from("flashcards").delete().eq("id", c.id); cards.reload(); }}>Delete</button>
              </Card>
            ))}
          </div>
        )
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit card" : "New card"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Deck">{(id) => <Input id={id} value={editing?.deck ?? ""} onChange={(e) => setEditing((x) => ({ ...x, deck: e.target.value }))} maxLength={80} list="decks" />}</Field>
          <datalist id="decks">{decks.map((d) => <option key={d} value={d} />)}</datalist>
          <Field label="Front (question)">{(id) => <Textarea id={id} rows={3} value={editing?.front ?? ""} onChange={(e) => setEditing((x) => ({ ...x, front: e.target.value }))} maxLength={2000} />}</Field>
          <Field label="Back (answer)">{(id) => <Textarea id={id} rows={4} value={editing?.back ?? ""} onChange={(e) => setEditing((x) => ({ ...x, back: e.target.value }))} maxLength={4000} />}</Field>
        </div>
      </Modal>
    </div>
  );
}

function Reviewer({ cards, onDone }: { cards: Flashcard[]; onDone: () => void }) {
  const toast = useToast();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const card = cards[i];

  if (!cards.length || !card) {
    return <EmptyState icon="checkCircle" title={reviewed ? `Done! ${reviewed} cards reviewed.` : "Nothing due right now"} action={reviewed ? <Button onClick={onDone}>Refresh</Button> : undefined}>Come back later, or add new cards.</EmptyState>;
  }

  const grade = async (g: number) => {
    const next = review(card, g);
    const { data: u } = await supabase.auth.getUser();
    const [{ error }] = await Promise.all([
      supabase.from("flashcards").update({
        ease: next.ease, interval_days: next.interval_days, repetitions: next.repetitions,
        due_at: next.due_at.toISOString(), last_reviewed_at: new Date().toISOString(),
      }).eq("id", card.id),
      supabase.from("study_activity").insert({ user_id: u.user?.id, kind: "flashcard_reviewed", ref_id: card.id }),
    ]);
    if (error) return toast(friendly(error), "error");
    setReviewed((r) => r + 1);
    setFlipped(false);
    setI((x) => x + 1);
  };

  return (
    <div>
      <div className="ink-2 mb-2 text-sm">Card {i + 1} of {cards.length}</div>
      <button onClick={() => setFlipped((f) => !f)} className="surface flex min-h-64 w-full flex-col items-center justify-center rounded-3xl border-2 line p-8 text-center shadow-sm" aria-live="polite">
        <div className="ink-2 mb-3 text-xs font-semibold uppercase tracking-wide">{flipped ? "Answer" : "Question"} · {card.deck}</div>
        <div className="text-xl font-semibold leading-snug">{flipped ? card.back : card.front}</div>
        {!flipped && <div className="ink-2 mt-6 text-xs">Tap to reveal</div>}
      </button>
      {flipped && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {GRADES.map((g) => (
            <Button key={g.grade} variant={g.grade === 0 ? "danger" : g.grade === 5 ? "primary" : "secondary"} onClick={() => grade(g.grade)} className="flex-col !h-auto py-2">
              <span>{g.label}</span><span className="text-[10px] font-normal opacity-80">{g.hint}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
