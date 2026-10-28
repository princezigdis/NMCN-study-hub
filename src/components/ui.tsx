import {
  type ButtonHTMLAttributes, type ComponentProps, createContext, type HTMLAttributes, type ReactNode,
  useCallback, useContext, useEffect, useId, useRef, useState,
} from "react";
import { Icon, type IconName } from "./Icon";
import { renderMarkdown, resolveStorageImages } from "../lib/markdown";

export const cx = (...c: unknown[]) => c.filter((x): x is string => typeof x === "string" && x.length > 0).join(" ");

// ---------- Buttons ----------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50",
  secondary: "surface border line text-[var(--ink)] hover:bg-[var(--surface-2)]",
  ghost: "text-[var(--ink)] hover:bg-[var(--surface-2)]",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
  accent: "bg-accent-400 text-brand-900 hover:bg-accent-500 disabled:opacity-60",
};

export function Button({ variant = "primary", size = "md", loading, icon, children, className, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: IconName }) {
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" };
  return (
    <button
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} width={size} height={size} viewBox="0 0 24 24" aria-label="Loading" role="status">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Layout ----------
export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("surface min-w-0 rounded-2xl border line p-4 sm:p-5", className)} {...rest}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="ink-2 mt-1 text-sm sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "success" | "danger" | "warning" | "info"; className?: string }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    brand: "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100",
    success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
    danger: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200",
    warning: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
    info: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  };
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export const DemoBadge = () => <Badge tone="warning">Demo content</Badge>;

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ published: "success", approved: "success", success: "success", active: "success", in_review: "info", draft: "neutral",
    unpublished: "warning", archived: "neutral", rejected: "danger", failed: "danger", suspended: "danger", refunded: "warning",
    initialized: "neutral", superseded: "neutral", open: "warning", resolved: "success", dismissed: "neutral", closed: "neutral",
    expired: "neutral", revoked: "danger", amount_mismatch: "danger", submitted: "success", in_progress: "info" } as const)[status] ?? "neutral";
  return <Badge tone={tone as "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="ink-2 flex items-center justify-center gap-3 py-16 text-sm"><Spinner /> {label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <Icon name="alert" className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function EmptyState({ icon = "book", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed line px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200"><Icon name={icon} size={24} /></div>
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="ink-2 mt-1 max-w-md text-sm">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, max = 100, tone = "brand", label }: { value: number; max?: number; tone?: "brand" | "accent" | "danger"; label?: string }) {
  const p = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const color = { brand: "bg-brand-500", accent: "bg-accent-400", danger: "bg-red-500" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--line)]" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="surface rounded-2xl border line p-4">
      <div className="ink-2 text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {hint && <div className="ink-2 mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

// ---------- Forms ----------
const inputCls = "w-full rounded-lg border line surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60";

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children(id)}
      {hint && !error && <p className="ink-2 text-xs">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export const Input = (p: ComponentProps<"input">) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: ComponentProps<"textarea">) => <textarea {...p} className={cx(inputCls, "min-h-24", p.className)} />;
export const Select = (p: ComponentProps<"select">) => <select {...p} className={cx(inputCls, "pr-8", p.className)} />;

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600")}>
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-5" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto rounded-xl border line surface p-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            value === t.id ? "bg-brand-700 text-white" : "ink-2 hover:bg-[var(--surface-2)]")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true"
        className={cx("surface flex max-h-[92vh] w-full flex-col rounded-t-2xl shadow-xl outline-none sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b line px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[var(--surface-2)]" aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t line px-5 py-3 safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirm ----------
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; resolve: (v: boolean) => void; danger?: boolean; confirmLabel?: string } | null>(null);
  const confirm = useCallback((title: string, body: ReactNode, opts?: { danger?: boolean; confirmLabel?: string }) =>
    new Promise<boolean>((resolve) => setState({ title, body, resolve, ...opts })), []);
  const node = state ? (
    <Modal open onClose={() => { state.resolve(false); setState(null); }} title={state.title}
      footer={<>
        <Button variant="secondary" onClick={() => { state.resolve(false); setState(null); }}>Cancel</Button>
        <Button variant={state.danger ? "danger" : "primary"} onClick={() => { state.resolve(true); setState(null); }}>{state.confirmLabel ?? "Confirm"}</Button>
      </>}>
      <div className="text-sm">{state.body}</div>
    </Modal>
  ) : null;
  return { confirm, confirmNode: node };
}

// ---------- Toasts ----------
interface Toast { id: number; message: string; tone: "success" | "error" | "info" }
const ToastCtx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg",
            t.tone === "success" ? "bg-brand-700" : t.tone === "error" ? "bg-red-600" : "bg-slate-800")}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Markdown ----------
export function Markdown({ md, className = "prose-ai" }: { md: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) resolveStorageImages(ref.current); }, [md]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />;
}
