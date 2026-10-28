// POST /functions/v1/ai-assist
// One entry point for every AI action in the app. Flow:
//   authenticate -> validate -> authorise context -> reserve credits ->
//   retrieve approved notes -> call provider -> settle (or refund) -> respond.
import { handler, HttpError, isUuid, json, readJson } from "../_shared/http.ts";
import { adminClient, env, flagEnabled, getSetting, requireUser } from "../_shared/supabase.ts";
import {
  type AiAction,
  buildDiagramPrompt,
  buildPrompt,
  buildVideoQuery,
  isAiAction,
  parseFlashcards,
  parsePracticeQuestions,
  type QuestionContext,
  type StudyMaterial,
  type VivaContext,
} from "../_shared/ai/prompts.ts";
import { createImageProvider, estimateCostUsd, generateText, mergeConfig, type ProviderKeys } from "../_shared/ai/registry.ts";
import { type Citation, ProviderError } from "../_shared/ai/types.ts";
import { searchVideos } from "../_shared/youtube.ts";

interface Body {
  action?: string;
  text?: string;
  idempotencyKey?: string;
  noteId?: string;
  topicId?: string;
  questionId?: string;
  stationAttemptId?: string;
  followUp?: string;
}

const RESERVE_ERRORS: Record<string, [number, string]> = {
  insufficient_credits: [402, "You don't have enough AI credits for this. Upgrade your plan or wait for your monthly reset."],
  plan_upgrade_required: [402, "This AI tool isn't included in your current plan."],
  image_limit_reached: [402, "You've used all the diagram generations in your plan this period."],
  web_search_limit_reached: [402, "You've used all the web searches in your plan this period."],
  video_search_limit_reached: [402, "You've used all the video searches in your plan this period."],
  rate_limited: [429, "You're sending requests too quickly. Please wait a moment."],
  budget_exceeded: [503, "The AI assistant has reached today's usage limit. Please try again tomorrow."],
  ai_disabled: [503, "The AI assistant is temporarily unavailable."],
  action_disabled: [403, "This AI tool is currently turned off."],
  account_suspended: [403, "Your account is suspended."],
  previous_attempt_failed: [409, "That request failed earlier. Please try again."],
};

const GROUNDED: AiAction[] = [
  "explain_simple", "explain_exam", "summarize", "expand_notes", "differentiate", "flashcards",
  "mnemonic", "practice_questions", "follow_up",
];

const DISCLAIMER = "AI-generated study support. It can make mistakes — check it against your approved notes and report any errors.";

Deno.serve(handler(Deno.env.get("ALLOWED_ORIGINS") ?? "*", async (req) => {
  const { user } = await requireUser(req);
  const admin = adminClient();
  const body = await readJson<Body>(req, 96 * 1024);

  // ---------- validation ----------
  if (!isAiAction(body.action)) throw new HttpError(400, "invalid_action");
  const action = body.action;
  const idem = String(body.idempotencyKey ?? "");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idem)) throw new HttpError(400, "invalid_idempotency_key");
  const cfg = mergeConfig(await getSetting(admin, "ai.config"));
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > cfg.max_input_chars) {
    throw new HttpError(413, "selection_too_long", `Please select at most ${cfg.max_input_chars} characters.`);
  }
  const needsText = !["rationale_expand", "viva_feedback"].includes(action);
  if (needsText && text.trim().length < 3) throw new HttpError(400, "selection_required", "Select some text first.");
  if (action === "follow_up" && !(body.followUp ?? "").trim()) throw new HttpError(400, "follow_up_required");
  for (const k of ["noteId", "topicId", "questionId", "stationAttemptId"] as const) {
    if (body[k] !== undefined && body[k] !== null && !isUuid(body[k])) throw new HttpError(400, `invalid_${k}`);
  }

  // ---------- feature flags ----------
  if (!(await flagEnabled(admin, "ai_assistant"))) throw new HttpError(503, "ai_disabled", RESERVE_ERRORS.ai_disabled[1]);
  if (action === "diagram" && !(await flagEnabled(admin, "ai_images"))) throw new HttpError(403, "action_disabled");
  if (action === "video_search" && !(await flagEnabled(admin, "video_search"))) throw new HttpError(403, "action_disabled");
  if (action === "web_search" && !(await flagEnabled(admin, "web_search"))) throw new HttpError(403, "action_disabled");

  // ---------- context the user is allowed to use (checked BEFORE charging) ----------
  const { data: prof } = await admin.from("profiles").select("programme_id, programmes(code)").eq("id", user.id).maybeSingle();
  const programme = ((prof as { programmes?: { code?: string } | null } | null)?.programmes?.code ?? null) as "RN" | "RM" | null;

  let question: QuestionContext | undefined;
  if (action === "rationale_expand") {
    if (!body.questionId) throw new HttpError(400, "question_required");
    question = await loadAnsweredQuestion(admin, user.id, body.questionId);
  }
  let viva: VivaContext | undefined;
  if (action === "viva_feedback") {
    if (!body.stationAttemptId) throw new HttpError(400, "station_attempt_required");
    viva = await loadVivaContext(admin, user.id, body.stationAttemptId);
  }

  let topicTitle: string | null = null;
  if (body.topicId) {
    const { data } = await admin.from("topics").select("title").eq("id", body.topicId).maybeSingle();
    topicTitle = data?.title ?? null;
  }

  // ---------- reserve credits (atomic, idempotent) ----------
  const { data: reservation, error: reserveErr } = await admin.rpc("ai_reserve", {
    p_user: user.id,
    p_action: action,
    p_idem: idem,
    p_context: stripNulls({ note_id: body.noteId, topic_id: body.topicId, question_id: body.questionId }),
  });
  if (reserveErr) throw new HttpError(500, "reserve_failed");
  const r = reservation as Record<string, unknown>;
  if (!r.ok) {
    const code = String(r.error ?? "reserve_failed");
    const [status, message] = RESERVE_ERRORS[code] ?? [400, code];
    throw new HttpError(status, code, message, { balance: r.balance, credits: r.credits });
  }
  const requestId = String(r.request_id);
  if (r.duplicate) {
    const { data: prev } = await admin.from("ai_requests").select("status, output_excerpt").eq("id", requestId).maybeSingle();
    return json({ requestId, duplicate: true, status: prev?.status, output: prev?.output_excerpt ?? null, aiGenerated: true });
  }

  const keys: ProviderKeys = { anthropic: Deno.env.get("ANTHROPIC_API_KEY"), openai: Deno.env.get("OPENAI_API_KEY") };
  const started = Date.now();
  let provider: string | undefined;
  let model: string | undefined;

  try {
    let output = "";
    let citations: Citation[] = [];
    let data: Record<string, unknown> = {};
    let inTok = 0, outTok = 0;

    if (action === "diagram") {
      const img = await createImageProvider(cfg.image_provider, keys).generateImage({
        prompt: buildDiagramPrompt(text, topicTitle), model: cfg.image_model, size: cfg.image_size, timeoutMs: Math.max(cfg.timeout_ms, 60000),
      });
      provider = img.provider; model = img.model;
      const path = `${user.id}/${requestId}.png`;
      const up = await admin.storage.from("ai-images").upload(path, img.bytes, { contentType: img.mime, upsert: false });
      if (up.error) throw new ProviderError("storage_failed", "Could not save the image", true);
      const signed = await admin.storage.from("ai-images").createSignedUrl(path, 60 * 60);
      data = { imagePath: path, imageUrl: signed.data?.signedUrl ?? null };
      output = "Diagram generated. AI images can contain errors in labels; verify against your notes.";
    } else if (action === "video_search") {
      const key = env("YOUTUBE_API_KEY");
      provider = "youtube"; model = "data-api-v3";
      const query = buildVideoQuery(text, topicTitle, programme);
      const videos = await searchVideos(key, query);
      if (!videos.length) throw new ProviderError("no_results", "No suitable videos were found", false);
      data = { videos, query };
      output = `Found ${videos.length} videos for "${query}". Videos are third-party content: check them against your approved notes.`;
    } else {
      let material: StudyMaterial[] = [];
      if (GROUNDED.includes(action)) {
        const { data: rows } = await admin.rpc("ai_retrieve_notes", {
          p_query: text.slice(0, 300), p_note: body.noteId ?? null, p_topic: body.topicId ?? null, p_limit: 3,
        });
        material = ((rows ?? []) as Array<{ note_id: string; title: string; topic: string; excerpt: string }>)
          .slice(0, 4).map((m) => ({ id: m.note_id, title: m.title, topic: m.topic, excerpt: m.excerpt }));
      }
      const prompt = buildPrompt({ action, text, programme, followUp: body.followUp, material, question, viva }, cfg.max_input_chars);
      const tier = r.tier === "fast" ? "fast" : "strong";
      const result = await generateText(cfg, keys, tier, {
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        maxTokens: Number(r.max_output_tokens ?? 1000),
        temperature: prompt.temperature,
        webSearch: action === "web_search",
      });
      provider = result.provider; model = result.model; inTok = result.inputTokens; outTok = result.outputTokens;
      output = result.text;
      citations = [
        ...material.map((m): Citation => ({ type: "note", id: m.id, title: m.title })),
        ...result.citations,
      ];

      if (action === "flashcards") {
        const cards = parseFlashcards(result.text);
        if (!cards.length) throw new ProviderError("unparseable_output", "The AI did not return usable flashcards", true);
        data = { cards };
        output = cards.map((c, i) => `**${i + 1}. ${c.front}**\n${c.back}`).join("\n\n");
      } else if (action === "practice_questions") {
        const questions = parsePracticeQuestions(result.text);
        if (!questions.length) throw new ProviderError("unparseable_output", "The AI did not return usable questions", true);
        data = { questions, unverified: true };
        output = `${questions.length} AI-generated practice questions (unverified; not part of the official question bank).`;
      } else if (action === "viva_feedback") {
        await admin.rpc("station_store_ai_feedback", { p_attempt: body.stationAttemptId, p_user: user.id, p_feedback: output });
      }
    }

    const cost = estimateCostUsd(cfg, model ?? "", inTok, outTok, Number(r.est_cost_usd ?? 0));
    const { data: settle } = await admin.rpc("ai_complete", {
      p_request: requestId, p_success: true, p_provider: provider, p_model: model,
      p_input_tokens: inTok, p_output_tokens: outTok, p_cost_usd: cost,
      p_latency_ms: Date.now() - started, p_error: null, p_excerpt: output.slice(0, 4000),
    });

    return json({
      requestId, action, output, data, citations,
      creditsCharged: r.credits, balance: (settle as { balance?: number } | null)?.balance ?? null,
      aiGenerated: true, model, disclaimer: DISCLAIMER,
    });
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : "internal_error";
    console.error("ai_action_failed", action, code, err instanceof Error ? err.message : "");
    const { data: settle } = await admin.rpc("ai_complete", {
      p_request: requestId, p_success: false, p_provider: provider ?? null, p_model: model ?? null,
      p_input_tokens: null, p_output_tokens: null, p_cost_usd: null,
      p_latency_ms: Date.now() - started, p_error: code, p_excerpt: null,
    });
    const friendly = code === "no_results"
      ? "No suitable results were found. Your credits were refunded."
      : "The AI assistant couldn't complete this request. Your credits were refunded. Please try again.";
    throw new HttpError(502, code, friendly, { refunded: true, balance: (settle as { balance?: number } | null)?.balance });
  }
}));

function stripNulls(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

// Only questions the student has ALREADY answered (practice, or a submitted exam
// whose rules allow review) can be explained, so the AI can't leak exam keys.
async function loadAnsweredQuestion(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  questionId: string,
): Promise<QuestionContext> {
  let selectedOptionId: string | null = null;

  const { data: practice } = await admin.from("practice_items")
    .select("selected_option_id, answered_at, practice_sessions!inner(user_id)")
    .eq("question_id", questionId).eq("practice_sessions.user_id", userId).not("answered_at", "is", null)
    .order("answered_at", { ascending: false }).limit(1);
  if (practice?.length) selectedOptionId = practice[0].selected_option_id;

  if (!practice?.length) {
    const { data: exam } = await admin.from("exam_attempt_items")
      .select("selected_option_id, exam_attempts!inner(user_id, status, exam_papers!inner(review_policy))")
      .eq("question_id", questionId).eq("exam_attempts.user_id", userId)
      .neq("exam_attempts.status", "in_progress").eq("exam_attempts.exam_papers.review_policy", "after_submit").limit(1);
    if (!exam?.length) throw new HttpError(403, "answer_first", "Answer this question first, then ask the AI to explain it.");
    selectedOptionId = exam[0].selected_option_id;
  }

  const { data: q } = await admin.from("questions").select("stem, clinical_scenario, source_reference").eq("id", questionId).single();
  const { data: opts } = await admin.from("question_options").select("id, label, body, is_correct, rationale")
    .eq("question_id", questionId).order("label");
  if (!q || !opts?.length) throw new HttpError(404, "question_not_found");
  type Opt = { id: string; label: string; body: string; is_correct: boolean; rationale: string | null };
  const options = opts as Opt[];
  return {
    stem: q.stem, scenario: q.clinical_scenario, source: q.source_reference,
    options: options.map((o) => ({ label: o.label, body: o.body, is_correct: o.is_correct, rationale: o.rationale })),
    selectedLabel: options.find((o) => o.id === selectedOptionId)?.label ?? null,
  };
}

async function loadVivaContext(admin: ReturnType<typeof adminClient>, userId: string, attemptId: string): Promise<VivaContext> {
  const { data: a } = await admin.from("station_attempts").select("station_id, viva_answers")
    .eq("id", attemptId).eq("user_id", userId).maybeSingle();
  if (!a) throw new HttpError(404, "attempt_not_found");
  const [{ data: s }, { data: vq }, { data: cl }] = await Promise.all([
    admin.from("clinical_stations").select("title, scenario").eq("id", a.station_id).single(),
    admin.from("station_viva_questions").select("id, prompt, expected_points, marks").eq("station_id", a.station_id).order("position"),
    admin.from("station_checklist_items").select("step, is_critical").eq("station_id", a.station_id).order("position"),
  ]);
  const answers = (a.viva_answers ?? {}) as Record<string, string>;
  const vivaRows = (vq ?? []) as Array<{ id: string; prompt: string; expected_points: string | null; marks: number }>;
  const checklistRows = (cl ?? []) as Array<{ step: string; is_critical: boolean }>;
  const items = vivaRows.map((v) => ({ prompt: v.prompt, expected: v.expected_points, marks: Number(v.marks), answer: answers[v.id] ?? "" }));
  if (answers.procedure) {
    // CAOSCE-style: the student described the procedure; mark it against the checklist.
    items.push({
      prompt: "Describe how you would perform the procedure, step by step.",
      expected: checklistRows.map((c) => c.step).join("; "), marks: checklistRows.length, answer: answers.procedure,
    });
  }
  return {
    title: s?.title ?? "Station", scenario: s?.scenario ?? "",
    items,
    checklist: checklistRows.map((c) => ({ step: c.step, critical: c.is_critical })),
  };
}
