import { supabase } from "./supabase";
import { AppError, toAppError } from "./errors";
import type {
  AiResponse, Dashboard, ExamCatalogue, ExamResult, ExamSessionData, NoteReader, QuestionItem,
  PracticeSession, Station, StationRubric, Wallet, Difficulty, Feedback,
} from "./types";

/** Call a Postgres RPC and throw a friendly AppError on failure. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

/** Call an Edge Function; surfaces its JSON {error, message} as AppError. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = await ctx.json().catch(() => null) as { error?: string; message?: string } | null;
      if (payload?.error) throw new AppError(payload.error, payload.message ?? payload.error, payload as Record<string, unknown>);
    }
    throw toAppError(error);
  }
  return data as T;
}

export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `k${Date.now().toString(36)}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- Section A ----------
export const api = {
  noteReader: (noteId: string, versionId?: string) =>
    rpc<NoteReader>("note_reader", { p_note: noteId, p_version: versionId ?? null }),
  noteProgress: (noteId: string, percent: number) => rpc<void>("note_progress", { p_note: noteId, p_percent: percent }),
  searchNotes: (query: string, programme?: string | null) =>
    rpc<Array<{ note_id: string; title: string; topic: string; course: string; snippet: string; rank: number }>>(
      "search_notes", { p_query: query, p_programme: programme ?? null, p_limit: 20 }),

  // ---------- Section B ----------
  practiceStart: (args: { count: number; programme?: string | null; courseId?: string | null; topicId?: string | null; difficulty?: Difficulty | null; mode?: string }) =>
    rpc<{ session_id: string; question_count: number; requested: number }>("practice_start", {
      p_count: args.count, p_programme: args.programme ?? null, p_course: args.courseId ?? null,
      p_topic: args.topicId ?? null, p_difficulty: args.difficulty ?? null, p_mode: args.mode ?? "random",
    }),
  practiceGet: (sessionId: string) => rpc<{ session: PracticeSession; items: QuestionItem[] }>("practice_get", { p_session: sessionId }),
  practiceAnswer: (sessionId: string, position: number, optionId: string) =>
    rpc<{ is_correct: boolean; feedback: Feedback; already_answered?: boolean }>("practice_answer", {
      p_session: sessionId, p_position: position, p_option: optionId,
    }),
  practiceFinish: (sessionId: string) => rpc<void>("practice_finish", { p_session: sessionId }),

  // ---------- Sections C & D ----------
  examCatalogue: (section: "C" | "D") => rpc<ExamCatalogue>("exam_catalogue", { p_section: section }),
  examStart: (paperId: string) => rpc<{ attempt_id: string; resumed: boolean }>("exam_start", { p_paper: paperId }),
  examGet: (attemptId: string) => rpc<ExamSessionData>("exam_get", { p_attempt: attemptId }),
  examSave: (attemptId: string, position: number, optionId: string | null, flagged?: boolean) =>
    rpc<{ saved: boolean; answered?: number; error?: string }>("exam_save_answer", {
      p_attempt: attemptId, p_position: position, p_option: optionId, p_flagged: flagged ?? null,
    }),
  examSubmit: (attemptId: string) => rpc<ExamResult>("exam_submit", { p_attempt: attemptId }),
  paperStations: (paperId: string) =>
    rpc<Array<{ id: string; title: string; kind: string; duration_minutes: number; is_demo: boolean; attempts: number }>>("paper_stations", { p_paper: paperId }),
  stationGet: (stationId: string) => rpc<Station>("station_get", { p_station: stationId }),
  stationSubmit: (stationId: string, answers: Record<string, string>) =>
    rpc<{ attempt_id: string; max_score: number; rubric: StationRubric }>("station_submit", { p_station: stationId, p_answers: answers }),
  stationSelfAssess: (attemptId: string, ticks: string[], vivaMarks: Record<string, number>) =>
    rpc<{ self_score: number; max_score: number; critical_missed: number }>("station_self_assess", {
      p_attempt: attemptId, p_ticks: ticks, p_viva_marks: vivaMarks,
    }),

  // ---------- Section E ----------
  dashboard: () => rpc<Dashboard>("my_dashboard"),
  wallet: () => rpc<Wallet>("my_wallet"),
  topicStats: () => rpc<Array<{ topic_id: string; topic: string; course: string; answered: number; correct: number; accuracy: number }>>("my_topic_stats"),

  // ---------- AI ----------
  ai: (body: {
    action: string; text?: string; noteId?: string; topicId?: string; questionId?: string;
    stationAttemptId?: string; followUp?: string; idempotencyKey: string;
  }) => callFunction<AiResponse>("ai-assist", body),

  // ---------- Payments ----------
  checkout: (purpose: "product" | "ai_plan", code: string) =>
    callFunction<{ authorizationUrl: string; reference: string; amountKobo: number; mode: string }>("payments-initialize", { purpose, code }),
  verifyPayment: (reference: string) =>
    callFunction<{ status: string; purpose: string; item: string }>("payments-verify", { reference }),
};

/** Signed URL for a private storage object (notes images, question images, AI images). */
export async function signedUrl(bucket: string, path: string, seconds = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
