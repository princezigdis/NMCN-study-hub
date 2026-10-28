// Prompt construction for every AI action. Pure functions: easy to test and
// to tune without touching the request/credit plumbing.

export const TEXT_ACTIONS = [
  "explain_simple", "explain_exam", "summarize", "expand_notes", "differentiate", "flashcards",
  "mnemonic", "practice_questions", "follow_up", "rationale_expand", "viva_feedback", "web_search",
] as const;
export const OTHER_ACTIONS = ["diagram", "video_search"] as const;
export type AiAction = typeof TEXT_ACTIONS[number] | typeof OTHER_ACTIONS[number];

export function isAiAction(a: unknown): a is AiAction {
  return typeof a === "string" &&
    ((TEXT_ACTIONS as readonly string[]).includes(a) || (OTHER_ACTIONS as readonly string[]).includes(a));
}

export interface StudyMaterial {
  id: string;
  title: string;
  topic?: string;
  excerpt: string;
}

export interface QuestionContext {
  stem: string;
  scenario?: string | null;
  options: Array<{ label: string; body: string; is_correct: boolean; rationale?: string | null }>;
  selectedLabel?: string | null;
  source?: string | null;
}

export interface VivaContext {
  title: string;
  scenario: string;
  items: Array<{ prompt: string; expected: string | null; marks: number; answer: string }>;
  checklist: Array<{ step: string; critical: boolean }>;
}

export interface PromptInput {
  action: AiAction;
  text: string;                       // selected passage / user question
  programme?: "RN" | "RM" | null;
  followUp?: string;                  // follow-up question about the selection
  material?: StudyMaterial[];         // retrieved approved notes
  question?: QuestionContext;         // for rationale_expand
  viva?: VivaContext;                 // for viva_feedback
}

export interface BuiltPrompt {
  system: string;
  user: string;
  temperature: number;
  expectsJson: boolean;
}

const BASE_SYSTEM = `You are the study assistant inside an exam-preparation app for Nigerian nursing (RN) and midwifery (RM) students preparing for Nursing and Midwifery Council of Nigeria (NMCN) examinations.

Rules you must follow:
- Teach accurately, using well-established nursing, midwifery and clinical knowledge. If you are not sure, say so plainly instead of guessing.
- When <study_material> is provided, base your answer on it first and cite it inline as [1], [2] matching the material numbers. Never claim a source says something it does not.
- Do not invent statistics, drug doses, legal requirements or official NMCN rules, formats or pass marks. For drug doses, defer to current prescribing references and local protocols.
- Never contradict an official answer key you are given; you may only explain it more deeply.
- This is educational support, not clinical advice for a real patient.
- Use clear British/Nigerian English, Markdown headings, short paragraphs, bullet points and tables where helpful.
- Stay within nursing/midwifery education. Politely decline unrelated or harmful requests.`;

function programmeLine(p?: string | null): string {
  if (p === "RM") return "The student is on the Registered Midwifery (RM) pathway.";
  if (p === "RN") return "The student is on the Registered Nursing (RN) pathway.";
  return "";
}

/** Strip characters that could break our XML-style delimiters, and cap length. */
export function sanitizeUserText(text: string, maxChars: number): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/<\/?(study_material|selection|question|answer_key|student_answers|rubric)[^>]*>/gi, "")
    .trim()
    .slice(0, maxChars);
}

function materialBlock(material?: StudyMaterial[]): string {
  if (!material?.length) return "";
  const parts = material.map((m, i) =>
    `[${i + 1}] ${m.title}${m.topic ? ` (topic: ${m.topic})` : ""}\n${m.excerpt}`
  );
  return `<study_material>\n${parts.join("\n\n---\n\n")}\n</study_material>\n\n`;
}

const INSTRUCTIONS: Record<Exclude<AiAction, "diagram" | "video_search">, string> = {
  explain_simple:
    "Explain the selection in simple, everyday language a first-year student would understand. Use a short analogy if it helps. End with a 2–3 point 'Key takeaways' list.",
  explain_exam:
    "Explain the selection at the depth expected in NMCN professional examinations: definitions, underlying physiology/pathophysiology, nursing or midwifery assessment, priority interventions with rationales, and common exam pitfalls. End with 'Likely exam angles'.",
  summarize:
    "Summarise the selection into concise revision notes: at most 8 bullets, keeping every essential fact, value and sequence. Add a one-line 'Remember' at the end.",
  expand_notes:
    "Expand the selection into detailed, well-structured study notes with headings (Definition, Causes/Risk factors, Clinical features, Assessment, Management, Nursing/Midwifery care, Complications, Health education). Use the study material first; mark anything not covered by it as general knowledge.",
  differentiate:
    "Identify the concepts being compared in the selection (two or more) and differentiate them in a Markdown comparison table (rows: definition, cause, features, management, key nursing points), followed by a short 'How to tell them apart in an exam' section. If only one concept is present, compare it with the concept it is most often confused with and say so.",
  flashcards:
    'Create 6–10 high-yield flashcards from the selection. Respond ONLY with JSON in this exact shape: {"cards":[{"front":"question","back":"concise answer"}]}. Each front must be a single, specific question.',
  mnemonic:
    "Create one memorable mnemonic for the list, sequence or set of features in the selection. Show the mnemonic, what each letter stands for, and a one-line tip on using it. If no list exists, create a memory aid for the key idea instead.",
  practice_questions:
    'Write 5 single-best-answer multiple-choice questions (options A–D) testing the selection at NMCN level. Respond ONLY with JSON: {"questions":[{"stem":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","rationale":"why the answer is right","distractors":{"B":"why wrong","C":"why wrong","D":"why wrong"}}]}. Exactly one answer per question; avoid "all of the above".',
  follow_up:
    "Answer the student's follow-up question about the selection. Be direct and specific, then add one sentence connecting it to exam practice.",
  rationale_expand:
    "The student has already answered this question. Using the official answer key and rationales given, explain in depth: why the keyed answer is correct, why each other option is wrong, the underlying principle, and how to recognise similar questions. If the student chose a wrong option, address the misconception behind that choice first. Do not change the keyed answer.",
  viva_feedback:
    "Give formative practice feedback on the student's viva/CAOSCE answers against the marking guide: for each prompt list points covered, points missed, and an indicative mark out of the available marks; then overall strengths, priorities to improve, and any critical safety omissions. State clearly at the top that this is AI practice feedback, not an official assessment.",
  web_search:
    "Search the web for trustworthy, current sources (e.g. WHO, NICE, national guidelines, peer-reviewed or university sources) relevant to the selection and summarise what they say for a nursing/midwifery student. Cite sources inline. Prefer guidelines over blogs.",
};

export function buildPrompt(input: PromptInput, maxChars = 12000): BuiltPrompt {
  if (input.action === "diagram" || input.action === "video_search") {
    throw new Error(`${input.action} does not use a text prompt`);
  }
  const selection = sanitizeUserText(input.text ?? "", maxChars);
  const system = [BASE_SYSTEM, programmeLine(input.programme)].filter(Boolean).join("\n\n");
  let user = materialBlock(input.material);

  if (input.action === "rationale_expand" && input.question) {
    const q = input.question;
    const key = q.options.map((o) =>
      `${o.label}. ${o.body}${o.is_correct ? "  [KEYED ANSWER]" : ""}\n   Rationale: ${o.rationale ?? "(none provided)"}`
    ).join("\n");
    user += `<question>\n${q.scenario ? `Scenario: ${q.scenario}\n` : ""}${q.stem}\n</question>\n<answer_key>\n${key}\n</answer_key>\n`;
    user += `Student selected: ${q.selectedLabel ?? "unknown"}\n${q.source ? `Source of item: ${q.source}\n` : ""}\n`;
    if (selection) user += `<selection>\n${selection}\n</selection>\n\n`;
  } else if (input.action === "viva_feedback" && input.viva) {
    const v = input.viva;
    const rubric = v.items.map((it, i) =>
      `Prompt ${i + 1} (${it.marks} marks): ${it.prompt}\nMarking guide: ${it.expected ?? "(not provided)"}\nStudent answer: ${sanitizeUserText(it.answer || "(no answer)", 4000)}`
    ).join("\n\n");
    const checklist = v.checklist.map((c) => `- ${c.step}${c.critical ? " (critical)" : ""}`).join("\n");
    user += `<rubric>\nStation: ${v.title}\nScenario: ${v.scenario}\n\n${rubric}${checklist ? `\n\nProcedure checklist:\n${checklist}` : ""}\n</rubric>\n\n`;
  } else {
    user += `<selection>\n${selection}\n</selection>\n\n`;
  }

  if (input.action === "follow_up") {
    user += `Follow-up question: ${sanitizeUserText(input.followUp ?? "", 1000)}\n\n`;
  }
  user += `Task: ${INSTRUCTIONS[input.action]}`;

  const expectsJson = input.action === "flashcards" || input.action === "practice_questions";
  return { system, user, temperature: expectsJson ? 0.4 : 0.3, expectsJson };
}

/** Extract the first JSON object from a model reply (tolerates code fences / chatter). */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export interface Flashcard { front: string; back: string }
export function parseFlashcards(text: string): Flashcard[] {
  const json = extractJson<{ cards?: Array<Partial<Flashcard>> }>(text);
  return (json?.cards ?? [])
    .filter((c) => typeof c.front === "string" && typeof c.back === "string" && c.front.trim() && c.back.trim())
    .slice(0, 20)
    .map((c) => ({ front: c.front!.trim().slice(0, 2000), back: c.back!.trim().slice(0, 4000) }));
}

export interface GeneratedQuestion {
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  answer: "A" | "B" | "C" | "D";
  rationale: string;
  distractors: Record<string, string>;
}
export function parsePracticeQuestions(text: string): GeneratedQuestion[] {
  const json = extractJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(text);
  const out: GeneratedQuestion[] = [];
  for (const q of json?.questions ?? []) {
    const opts = q.options ?? {} as Record<string, string>;
    const labels = ["A", "B", "C", "D"] as const;
    if (!q.stem || !labels.every((l) => typeof opts[l] === "string" && opts[l].trim())) continue;
    if (!q.answer || !labels.includes(q.answer)) continue;
    out.push({
      stem: q.stem.trim(),
      options: { A: opts.A, B: opts.B, C: opts.C, D: opts.D },
      answer: q.answer,
      rationale: (q.rationale ?? "").trim(),
      distractors: q.distractors ?? {},
    });
  }
  return out.slice(0, 10);
}

/** Image prompt for an educational diagram (no LLM call needed). */
export function buildDiagramPrompt(text: string, topic?: string | null): string {
  const subject = sanitizeUserText(text, 600).replace(/\s+/g, " ");
  return [
    "Clean, accurate educational diagram for nursing and midwifery students.",
    topic ? `Topic: ${topic}.` : "",
    `Illustrate: ${subject}`,
    "Flat vector style, white background, clear English labels with correct spelling, no photorealistic gore,",
    "no patient faces, no brand logos, high contrast, suitable for a study handout.",
  ].filter(Boolean).join(" ");
}

/** Build a concise YouTube search query from a topic and/or selection. */
export function buildVideoQuery(text: string, topic?: string | null, programme?: string | null): string {
  const base = (topic && topic.trim()) || sanitizeUserText(text, 400);
  const words = base.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 10);
  const suffix = programme === "RM" ? "midwifery" : "nursing";
  return `${words.join(" ")} ${suffix} lecture`.trim();
}
