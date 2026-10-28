// Shapes returned by the database RPCs and tables the UI uses.

export type ProgrammeCode = "RN" | "RM";
export type PublicationStatus = "draft" | "in_review" | "published" | "unpublished" | "archived";
export type VersionStatus = "draft" | "in_review" | "approved" | "superseded" | "rejected";
export type QuestionBank = "practice" | "section_c" | "section_d";
export type Difficulty = "easy" | "medium" | "hard";
export type AppRole = "super_admin" | "content_admin" | "question_admin" | "reviewer" | "exam_admin" | "support" | "finance";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  programme_id: string | null;
  curriculum_version_id: string | null;
  institution: string | null;
  exam_target_date: string | null;
  status: "active" | "suspended";
  onboarded: boolean;
  created_at: string;
}

export interface Programme { id: string; code: ProgrammeCode; name: string }

export interface Course {
  id: string; code: string; title: string; description: string | null; level: string | null;
  position: number; status: PublicationStatus; is_demo: boolean; source: string | null;
}
export interface Module { id: string; course_id: string; title: string; description: string | null; position: number; status: PublicationStatus }
export interface Topic {
  id: string; module_id: string; parent_topic_id: string | null; title: string; summary: string | null;
  position: number; status: PublicationStatus;
}
export interface Note {
  id: string; topic_id: string; title: string; kind: "note" | "handout"; position: number; status: PublicationStatus;
  current_version_id: string | null; downloadable: boolean; is_demo: boolean; updated_at: string;
}
export interface NoteVersion {
  id: string; note_id: string; version: number; body_md: string; source_reference: string | null;
  change_summary: string | null; status: VersionStatus; reviewed_at: string | null; review_due_at: string | null; created_at: string;
}

export interface NoteReader {
  note: { id: string; title: string; kind: string; downloadable: boolean; is_demo: boolean; status: PublicationStatus };
  version: { id: string; version: number; body_md: string; source_reference: string | null; reviewed_at: string | null; review_due_at: string | null; status: VersionStatus; is_preview: boolean };
  breadcrumb: { topic_id: string; topic: string; module: string; course_id: string; course: string; course_code: string } | null;
  references: Array<{ citation: string; url: string | null }>;
  attachments: Array<{ id: string; file_name: string; mime_type: string; size_bytes: number; storage_path: string; downloadable: boolean }>;
  related_question_count: number;
  bookmarked: boolean;
  progress: number | null;
  highlights: Array<{ id: string; quote: string; color: string; comment: string | null }>;
}

export interface PublicOption { id: string; label: string; body: string }
export interface FeedbackOption { id: string; label: string; body: string; is_correct: boolean; rationale: string | null }
export interface Feedback { correct_option_id: string; source_reference: string | null; options: FeedbackOption[] }

export interface QuestionItem {
  position: number;
  question_id: string;
  stem: string;
  scenario: string | null;
  image_path: string | null;
  difficulty: Difficulty;
  topic_id: string | null;
  topic: string | null;
  is_demo: boolean;
  options: PublicOption[];
  selected_option_id: string | null;
  is_correct?: boolean | null;
  bookmarked?: boolean;
  flagged?: boolean;
  feedback?: Feedback | null;
}

export interface PracticeSession {
  id: string; mode: "random" | "retry_incorrect" | "saved"; question_count: number; answered_count: number;
  correct_count: number; status: "in_progress" | "completed"; started_at: string; completed_at: string | null;
  filters: Record<string, unknown>;
}

export interface ExamResult {
  score: number; total: number; percent: number | null; status: string; pass_mark_percent: number | null;
  passed: boolean | null; answered: number;
  by_topic: Array<{ topic: string; correct: number; total: number; percent: number }>;
}

export interface ExamSessionData {
  attempt: { id: string; status: "in_progress" | "submitted" | "expired"; started_at: string; deadline_at: string; submitted_at: string | null; score: number | null; total: number; percent: number | null };
  server_now: string;
  paper: { id: string; title: string; paper_number: number; duration_minutes: number; instructions: string | null; review_policy: string; pass_mark_percent: number | null };
  config: { id: string; title: string; section: "C" | "D"; is_demo: boolean };
  review_available: boolean;
  result: ExamResult | null;
  items: QuestionItem[];
}

export interface ExamPaperSummary {
  id: string; paper_number: number; title: string; kind: "objective" | "viva" | "caosce"; question_count: number;
  duration_minutes: number; pass_mark_percent: number | null; attempts_used: number; open_attempt_id: string | null;
  best_percent: number | null; station_count: number;
}
export interface ExamCatalogue {
  has_access: boolean;
  product: { code: string; name: string; price_kobo: number; access_days: number | null; description: string | null } | null;
  entitlement: { expires_at: string | null; source: string } | null;
  configs: Array<{ id: string; title: string; description: string | null; instructions: string | null; is_demo: boolean; max_attempts: number | null; programme: string | null; papers: ExamPaperSummary[] }>;
  history: Array<{ id: string; paper: string; paper_number: number; config: string; status: string; percent: number | null; score: number | null; total: number; started_at: string; submitted_at: string | null }>;
}

export interface Station {
  id: string; title: string; kind: "viva" | "caosce"; scenario: string; candidate_instructions: string | null;
  duration_minutes: number; is_demo: boolean; source_reference: string | null; checklist_count: number;
  viva_questions: Array<{ id: string; prompt: string; marks: number }>;
}
export interface StationRubric {
  examiner_notes: string | null;
  checklist: Array<{ id: string; step: string; points: number; is_critical: boolean }>;
  viva: Array<{ id: string; prompt: string; expected_points: string | null; marks: number }>;
}

export interface Wallet {
  plan_code: string; plan_name: string; balance: number; monthly_credits: number; period_end: string;
  images_used: number; image_limit: number; web_searches_used: number; web_search_limit: number;
  video_searches_used: number; video_search_limit: number;
}

export interface TopicStat { topic_id: string; topic: string; course: string; answered: number; correct: number; accuracy: number }

export interface Dashboard {
  profile: { full_name: string | null; programme: ProgrammeCode | null; programme_name: string | null; exam_target_date: string | null; institution: string | null } | null;
  streak_days: number;
  practice: { answered: number; correct: number };
  last_7_days: Array<{ day: string; questions: number }>;
  weak_topics: TopicStat[];
  strong_topics: TopicStat[];
  goals: Array<{ id: string; period: "daily" | "weekly"; metric: string; target: number; current: number }>;
  flashcards_due: number;
  recent_notes: Array<{ note_id: string; title: string; percent: number; last_viewed_at: string }>;
  recent_practice: Array<{ id: string; mode: string; question_count: number; answered_count: number; correct_count: number; status: string; started_at: string }>;
  exam_history: Array<{ id: string; section: "C" | "D"; paper: string; config: string; percent: number | null; status: string; started_at: string }>;
  readiness: { attempts: number; avg_percent: number | null; label: string };
  course_progress: Array<{ course_id: string; course: string; notes_total: number; notes_done: number }>;
  entitlements: Array<{ product_code: string; expires_at: string | null; source: string }>;
  wallet: Wallet;
  unread_notifications: number;
}

export interface AiPlan {
  code: string; name: string; monthly_credits: number; price_kobo: number; period_days: number;
  image_limit: number; web_search_limit: number; video_search_limit: number; allowed_actions: string[]; position: number; active: boolean;
}
export interface AiActionCost {
  action: string; label: string; credits: number; tier: string; max_output_tokens: number;
  est_provider_cost_usd: number; enabled: boolean; description: string | null;
}
export interface Product { code: string; name: string; description: string | null; price_kobo: number; access_days: number | null; active: boolean }

export interface Flashcard {
  id: string; deck: string; front: string; back: string; source: string; ease: number; interval_days: number;
  repetitions: number; due_at: string; last_reviewed_at: string | null;
}

export interface AiResponse {
  requestId: string;
  action: string;
  output: string;
  data?: {
    cards?: Array<{ front: string; back: string }>;
    questions?: Array<{ stem: string; options: Record<string, string>; answer: string; rationale: string; distractors: Record<string, string> }>;
    videos?: Array<{ videoId: string; title: string; channel: string; thumbnail: string; url: string }>;
    imageUrl?: string | null;
    imagePath?: string;
    query?: string;
    unverified?: boolean;
  };
  citations?: Array<{ type: "note" | "web"; title: string; url?: string; id?: string }>;
  creditsCharged?: number;
  balance?: number | null;
  aiGenerated: true;
  disclaimer?: string;
  duplicate?: boolean;
}
