// Spaced repetition (SM-2 variant) for flashcards.
// grade: 0 = forgot, 3 = hard, 4 = good, 5 = easy.

export interface SrsState {
  ease: number;
  interval_days: number;
  repetitions: number;
}

export interface SrsResult extends SrsState {
  due_at: Date;
}

export const GRADES = [
  { grade: 0, label: "Forgot", hint: "Show again soon" },
  { grade: 3, label: "Hard", hint: "Shorter gap" },
  { grade: 4, label: "Good", hint: "Normal gap" },
  { grade: 5, label: "Easy", hint: "Longer gap" },
] as const;

export function review(state: SrsState, grade: number, now = new Date()): SrsResult {
  const g = Math.max(0, Math.min(5, Math.round(grade)));
  let { ease, interval_days, repetitions } = state;

  if (g < 3) {
    repetitions = 0;
    interval_days = 0;           // relearn today (10 minutes)
  } else {
    repetitions += 1;
    if (repetitions === 1) interval_days = 1;
    else if (repetitions === 2) interval_days = g === 5 ? 4 : 3;
    else interval_days = Math.round(interval_days * ease * (g === 3 ? 0.8 : g === 5 ? 1.3 : 1));
  }
  ease = Math.max(1.3, Math.round((ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02))) * 100) / 100);
  interval_days = Math.min(interval_days, 365);

  const due = new Date(now);
  if (interval_days === 0) due.setMinutes(due.getMinutes() + 10);
  else due.setDate(due.getDate() + interval_days);
  return { ease, interval_days, repetitions, due_at: due };
}
