import { rpc } from "./api";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type J = any;

// ---------- Viva ----------
export const viva = {
  home: () => rpc<J>("viva_home"),
  examiners: () => rpc<J[]>("viva_examiners"),
  cases: (category?: string | null) => rpc<J[]>("viva_cases_list", { p_category: category ?? null }),
  progress: () => rpc<J>("viva_progress"),
  start: (a: { mode: string; category?: string | null; count?: number; style?: string; caseId?: string | null }) =>
    rpc<string>("viva_start", { p_mode: a.mode, p_category: a.category ?? null, p_count: a.count ?? 5, p_style: a.style ?? "friendly", p_case: a.caseId ?? null }),
  get: (id: string) => rpc<J>("viva_get", { p_attempt: id }),
  answer: (attempt: string, question: string, answer: string, source: "text" | "voice") =>
    rpc<J>("viva_answer", { p_attempt: attempt, p_question: question, p_answer: answer, p_source: source }),
  selfAdjust: (response: string, points: string[]) => rpc<J>("viva_self_adjust", { p_response: response, p_points: points }),
  report: (id: string) => rpc<J>("viva_report", { p_attempt: id }),
  finish: (id: string) => rpc<J>("viva_finish", { p_attempt: id }),
};

// ---------- CAOSCE ----------
export const caosce = {
  home: () => rpc<J>("caosce_home"),
  categories: () => rpc<J[]>("caosce_categories_list"),
  library: (category?: string | null, q?: string) => rpc<J[]>("caosce_library", { p_category: category ?? null, p_q: q ?? null }),
  procedure: (id: string) => rpc<J>("caosce_procedure", { p_id: id }),
  video: (id: string) => rpc<J>("caosce_video_get", { p_video: id }),
  videoProgress: (id: string, seconds: number, completed = false) => rpc<void>("caosce_video_progress", { p_video: id, p_seconds: Math.floor(seconds), p_completed: completed }),
  mark: (procedure: string, stage: string, step?: string) => rpc<void>("caosce_progress_mark", { p_procedure: procedure, p_stage: stage, p_step: step ?? null }),
  exercise: (id: string) => rpc<J>("caosce_exercise_get", { p_exercise: id }),
  exerciseCheck: (id: string, selected: string[]) => rpc<J>("caosce_exercise_check", { p_exercise: id, p_selected: selected }),
  sequenceCheck: (procedure: string, order: string[]) => rpc<J>("caosce_sequence_check", { p_procedure: procedure, p_order: order }),
  equipmentCheck: (procedure: string, selected: string[]) => rpc<J>("caosce_equipment_check", { p_procedure: procedure, p_selected: selected }),
  rationaleCheck: (step: string, answer: string) => rpc<J>("caosce_rationale_check", { p_step: step, p_answer: answer }),
  questions: (procedure?: string | null, count = 10) => rpc<J[]>("caosce_questions_get", { p_procedure: procedure ?? null, p_count: count }),
  questionCheck: (id: string, answer: J) => rpc<J>("caosce_question_check", { p_question: id, p_answer: answer }),
  exams: () => rpc<J>("caosce_exams_list"),
  examStart: (exam: string, mode: "mock" | "timed_station" | "revision" = "mock", position?: number) =>
    rpc<string>("caosce_exam_start", { p_exam: exam, p_mode: mode, p_position: position ?? null }),
  examStartRandom: () => rpc<string>("caosce_exam_start_random"),
  examGet: (id: string) => rpc<J>("caosce_exam_get", { p_attempt: id }),
  examSave: (id: string, position: number, answers: J) => rpc<J>("caosce_exam_save", { p_attempt: id, p_position: position, p_answers: answers }),
  examNext: (id: string) => rpc<J>("caosce_exam_next", { p_attempt: id }),
  examReport: (id: string) => rpc<J>("caosce_exam_report", { p_attempt: id }),
  dashboard: () => rpc<J>("caosce_dashboard"),
};

// ---------- Admin ----------
export const labAdmin = {
  publish: (table: string, id: string, reviewer?: string) => rpc<void>("lab_publish", { p_table: table, p_id: id, p_reviewer: reviewer ?? null }),
  unpublish: (table: string, id: string) => rpc<void>("lab_unpublish", { p_table: table, p_id: id }),
  publishAll: (area: "viva" | "caosce", reviewer: string) => rpc<J>("lab_publish_all", { p_area: area, p_reviewer: reviewer }),
  duplicate: (id: string) => rpc<string>("lab_duplicate_procedure", { p_id: id }),
  reorder: (table: string, ids: string[]) => rpc<void>("lab_reorder", { p_table: table, p_ids: ids }),
  analytics: () => rpc<J>("lab_analytics"),
};

/** Subdomain option: "viva." or "caosce." host sends "/" to that section. */
export function hostSection(): "viva" | "caosce" | null {
  const h = typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
  if (h.startsWith("viva.")) return "viva";
  if (h.startsWith("caosce.")) return "caosce";
  return null;
}

/** Plain-language percent colour tone. */
export const tone = (pct: number | null | undefined) => (pct == null ? "neutral" : pct >= 70 ? "success" : pct >= 50 ? "warning" : "danger") as "neutral" | "success" | "warning" | "danger";
