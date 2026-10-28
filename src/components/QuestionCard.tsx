import { type ReactNode, useEffect, useState } from "react";
import { signedUrl } from "../lib/api";
import type { Feedback, QuestionItem } from "../lib/types";
import { Icon } from "./Icon";
import { Badge, cx, DemoBadge, Markdown } from "./ui";

/**
 * Renders one question. In practice/review mode, once `feedback` exists it marks
 * the right/wrong options and shows why EACH option is right or wrong.
 */
export function QuestionCard({ item, number, total, selected, onSelect, feedback, disabled, headerRight }: {
  item: QuestionItem;
  number: number;
  total: number;
  selected: string | null;
  onSelect?: (optionId: string) => void;
  feedback?: Feedback | null;
  disabled?: boolean;
  headerRight?: ReactNode;
}) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    setImg(null);
    if (item.image_path) signedUrl("question-images", item.image_path).then(setImg);
  }, [item.image_path]);

  const revealed = !!feedback;
  const byId = new Map((feedback?.options ?? []).map((o) => [o.id, o]));
  const correctId = feedback?.correct_option_id;

  return (
    <article aria-labelledby={`q-${item.question_id}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-brand-700 dark:text-brand-300">Question {number} of {total}</span>
        {item.topic && <Badge>{item.topic}</Badge>}
        <Badge tone={item.difficulty === "hard" ? "danger" : item.difficulty === "easy" ? "success" : "info"}>{item.difficulty}</Badge>
        {item.is_demo && <DemoBadge />}
        <div className="ml-auto">{headerRight}</div>
      </div>

      {item.scenario && (
        <div className="surface-2 mb-3 rounded-xl border line p-3 text-sm leading-relaxed">
          <div className="ink-2 mb-1 text-xs font-semibold uppercase tracking-wide">Clinical scenario</div>
          {item.scenario}
        </div>
      )}
      <h2 id={`q-${item.question_id}`} className="mb-4 text-lg font-semibold leading-snug sm:text-xl">{item.stem}</h2>
      {img && <img src={img} alt="Question illustration" className="mb-4 max-h-80 rounded-xl border line" />}

      <div className="space-y-2" role="radiogroup" aria-label="Answer options">
        {item.options.map((o) => {
          const isSel = selected === o.id;
          const isCorrect = revealed && o.id === correctId;
          const isWrongPick = revealed && isSel && o.id !== correctId;
          const fb = byId.get(o.id);
          return (
            <div key={o.id}>
              <button
                role="radio" aria-checked={isSel}
                disabled={disabled || revealed || !onSelect}
                onClick={() => onSelect?.(o.id)}
                className={cx(
                  "flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3 text-left text-[15px] transition-colors",
                  isCorrect ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : isWrongPick ? "border-red-500 bg-red-50 dark:bg-red-950/40"
                    : isSel ? "border-brand-500 bg-brand-50 dark:bg-brand-900/40"
                    : "line surface hover:border-brand-300",
                  (disabled || revealed) && !isSel && !isCorrect && "opacity-90",
                )}
              >
                <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  isCorrect ? "bg-emerald-600 text-white" : isWrongPick ? "bg-red-600 text-white" : isSel ? "bg-brand-600 text-white" : "surface-2 border line")}>
                  {isCorrect ? <Icon name="check" size={14} /> : isWrongPick ? <Icon name="x" size={14} /> : o.label}
                </span>
                <span className="flex-1">{o.body}</span>
              </button>
              {revealed && fb?.rationale && (
                <div className={cx("ml-9 mt-1 rounded-lg px-3 py-2 text-sm",
                  isCorrect ? "text-emerald-900 dark:text-emerald-200" : "ink-2")}>
                  <span className="font-semibold">{isCorrect ? `Why ${o.label} is correct: ` : `Why not ${o.label}: `}</span>
                  <Markdown md={fb.rationale} className="prose-ai inline" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {revealed && feedback?.source_reference && (
        <p className="ink-2 mt-3 text-xs"><b>Reference:</b> {feedback.source_reference}</p>
      )}
    </article>
  );
}
