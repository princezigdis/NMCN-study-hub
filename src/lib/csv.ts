// CSV parsing/validation for bulk question import, and CSV export.
// The server re-validates everything; this gives admins an instant preview.

export const QUESTION_COLUMNS = [
  "bank", "course_code", "topic_title", "stem", "scenario", "difficulty", "programmes",
  "option_a", "rationale_a", "option_b", "rationale_b", "option_c", "rationale_c",
  "option_d", "rationale_d", "option_e", "rationale_e", "correct", "source", "tags",
] as const;

export type QuestionRow = Partial<Record<typeof QUESTION_COLUMNS[number], string>>;

/** RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface ValidatedRow {
  index: number;          // 1-based data row number (excluding header)
  row: QuestionRow;
  errors: string[];
  warnings: string[];
}

export function rowsToObjects(table: string[][]): { header: string[]; rows: QuestionRow[]; unknownColumns: string[] } {
  if (!table.length) return { header: [], rows: [], unknownColumns: [] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const unknownColumns = header.filter((h) => h && !(QUESTION_COLUMNS as readonly string[]).includes(h));
  const rows = table.slice(1).map((cells) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { if (h) o[h] = (cells[i] ?? "").trim(); });
    return o as QuestionRow;
  });
  return { header, rows, unknownColumns };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function validateQuestionRows(rows: QuestionRow[]): ValidatedRow[] {
  const seenStems = new Map<string, number>();
  return rows.map((row, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const bank = (row.bank || "practice").toLowerCase();
    if (!["practice", "section_c", "section_d"].includes(bank)) errors.push(`bank must be practice, section_c or section_d (got "${row.bank}")`);
    if (!row.stem || row.stem.length < 5) errors.push("stem is required (at least 5 characters)");
    if (row.stem && row.stem.length > 4000) errors.push("stem is longer than 4000 characters");
    if (!row.topic_title && !row.course_code) errors.push("topic_title or course_code is required");

    const letters = ["a", "b", "c", "d", "e"] as const;
    const present = letters.filter((l) => (row[`option_${l}`] ?? "").trim() !== "");
    if (present.length < 2) errors.push("at least two options are required");
    const correct = (row.correct ?? "").trim().toUpperCase();
    if (!/^[A-E]$/.test(correct)) errors.push("correct must be a single letter A–E");
    else if (!present.includes(correct.toLowerCase() as typeof letters[number])) errors.push(`correct answer ${correct} has no option text`);
    for (const l of present) {
      if (!(row[`rationale_${l}`] ?? "").trim()) warnings.push(`option ${l.toUpperCase()} has no rationale (required before publishing)`);
    }
    const diff = (row.difficulty || "medium").toLowerCase();
    if (!["easy", "medium", "hard"].includes(diff)) errors.push("difficulty must be easy, medium or hard");
    const progs = (row.programmes || "RN,RM").split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
    if (!progs.length || progs.some((p) => p !== "RN" && p !== "RM")) errors.push("programmes must be RN, RM or RN,RM");
    if (!row.source) warnings.push("no source/reference given");

    if (row.stem) {
      const key = `${bank}|${norm(row.stem)}`;
      const prev = seenStems.get(key);
      if (prev) errors.push(`duplicate of row ${prev} in this file`);
      else seenStems.set(key, i + 1);
    }
    return { index: i + 1, row, errors, warnings };
  });
}

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection on export.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: Array<Record<string, unknown>>): string {
  return [header.join(","), ...rows.map((r) => header.map((h) => escapeCell(r[h])).join(","))].join("\r\n");
}

export const QUESTION_TEMPLATE = toCsv(QUESTION_COLUMNS, [{
  bank: "practice", course_code: "DEMO-FON", topic_title: "Vital Signs",
  stem: "What is the normal resting respiratory rate for a healthy adult?", scenario: "", difficulty: "easy",
  programmes: "RN,RM",
  option_a: "8–10 breaths per minute", rationale_a: "Below 12/min is bradypnoea.",
  option_b: "12–20 breaths per minute", rationale_b: "Correct: the normal adult resting range.",
  option_c: "24–30 breaths per minute", rationale_c: "Tachypnoea in adults.",
  option_d: "30–40 breaths per minute", rationale_d: "Closer to an infant's normal rate.",
  option_e: "", rationale_e: "", correct: "B", source: "Your reviewed textbook/guideline", tags: "vital signs,respiration",
}]);

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
