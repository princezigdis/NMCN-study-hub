// Turns database / Edge Function error codes into messages students understand.

const MESSAGES: Record<string, string> = {
  not_authenticated: "Please sign in to continue.",
  account_suspended: "Your account is suspended. Contact support if you think this is a mistake.",
  invalid_count: "Choose 10, 20, 25, 50 or 100 questions.",
  no_questions_available: "No questions match these filters yet. Try a different course, topic or difficulty.",
  session_not_found: "That practice session could not be found.",
  invalid_option: "That answer option isn't valid for this question.",
  exam_not_available: "This exam isn't available right now.",
  payment_required: "This section needs to be unlocked first.",
  max_attempts_reached: "You've used all the attempts allowed for this paper.",
  no_questions_in_pool: "This paper has no questions yet. Please check back soon.",
  attempt_not_found: "That exam attempt could not be found.",
  attempt_closed: "This exam has already been submitted.",
  time_up: "Time is up. Your exam has been submitted.",
  station_not_available: "This station isn't available.",
  note_not_found: "This note isn't available.",
  note_has_no_published_version: "This note hasn't been published yet.",
  permission_denied: "You don't have permission to do that.",
  reason_required: "Please give a reason.",
  question_invalid: "The question isn't valid yet.",
  payments_not_configured: "Payments aren't set up yet. Please try again later.",
  already_has_access: "You already have access to this section.",
  selection_required: "Select some text first.",
  selection_too_long: "That selection is too long. Select a shorter passage.",
  answer_first: "Answer this question first, then ask the AI to explain it.",
  invalid_json: "Something went wrong sending your request.",
  internal_error: "Something went wrong. Please try again.",
};

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

/** Normalise any thrown value (PostgrestError, FunctionsHttpError, Error) to AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const raw = (err as { message?: string })?.message ?? String(err ?? "");
  // Database exceptions look like "payment_required:section_c" or "question_invalid: details".
  const code = raw.split(/[:\s]/)[0]?.trim() || "internal_error";
  const detail = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1).trim() : "";
  if (code === "question_invalid" && detail) return new AppError(code, `Not ready to publish: ${detail}`);
  if (code === "permission_denied") return new AppError(code, MESSAGES.permission_denied);
  if (MESSAGES[code]) return new AppError(code, MESSAGES[code]);
  if (/failed to fetch|network/i.test(raw)) return new AppError("network", "You appear to be offline. Check your connection and try again.");
  return new AppError(code, raw || MESSAGES.internal_error);
}

export function friendly(err: unknown): string {
  return toAppError(err).message;
}
