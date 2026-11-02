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
  internal_error: "Unable to process request right now. Please try again.",
  duplicate_bookmark: "This item is already saved.",
  insufficient_credits: "You're out of AI credits. Top up to continue.",
  procedure_not_available: "This procedure isn't available right now.",
  video_not_available: "This video isn't available right now.",
  exercise_not_available: "This exercise isn't available right now.",
  question_not_found: "That question could not be found.",
  step_not_found: "That step could not be found.",
  no_content: "There is no published content for this yet. Please check back soon.",
  no_weak_topics: "No weak topics found yet. Complete a few sessions first.",
  programme_not_set: "Choose your programme (RN or RM) in your profile first.",
  answer_empty: "Please write or say your answer first.",
  answer_too_long: "That answer is too long. Shorten it and try again.",
  already_answered: "You have already answered this question.",
  not_allowed_in_mock: "This is not available in mock mode.",
  attempt_not_finished: "Finish this attempt to see the report.",
  invalid_answer: "That answer isn't valid.",
  invalid_answers: "Your answers could not be saved. Try again.",
  invalid_mode: "That mode isn't available.",
  invalid_stage: "That stage isn't valid.",
  procedure_needs_steps: "Add at least one step before publishing this procedure.",
  procedure_needs_source: "Add at least one source reference before publishing this procedure.",
  reviewer_required: "Enter the name of the tutor who reviewed this content.",
  case_needs_questions: "Add at least one question before publishing this case.",
  forbidden: "You don't have permission to do that.",
  track_locked: "Your study track is locked. Switching tracks is a paid option on your profile.",
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
  if (/duplicate key|already exists|unique constraint|23505/i.test(raw)) return new AppError("duplicate", MESSAGES.duplicate_bookmark);
  if (/failed to fetch|network/i.test(raw)) return new AppError("network", "You appear to be offline. Check your connection and try again.");
  // Never surface raw technical text (SQL, stack traces, codes) to students.
  return new AppError(code, MESSAGES.internal_error);
}

export function friendly(err: unknown): string {
  return toAppError(err).message;
}
