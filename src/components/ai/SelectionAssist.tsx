import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";

/**
 * Wrap readable content. When the student selects text inside it, a small
 * toolbar appears with "Ask AI" (and optional "Highlight").
 */
export function SelectionAssist({ children, onAsk, onHighlight }: {
  children: ReactNode;
  onAsk: (text: string) => void;
  onHighlight?: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);

  const update = useCallback(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !ref.current) { setSel(null); return; }
    const range = s.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) { setSel(null); return; }
    const text = s.toString().trim();
    if (text.length < 3) { setSel(null); return; }
    const rect = range.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    setSel({
      text: text.slice(0, 12000),
      x: Math.min(Math.max(rect.left + rect.width / 2 - box.left, 90), box.width - 90),
      y: rect.top - box.top,
    });
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onChange = () => { clearTimeout(t); t = setTimeout(update, 180); };
    document.addEventListener("selectionchange", onChange);
    return () => { document.removeEventListener("selectionchange", onChange); clearTimeout(t); };
  }, [update]);

  return (
    <div ref={ref} className="relative">
      {children}
      {sel && (
        <div className="absolute z-30 -translate-x-1/2 -translate-y-full pb-2" style={{ left: sel.x, top: sel.y }}>
          <div className="flex overflow-hidden rounded-xl bg-brand-900 text-white shadow-lg">
            <button className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium hover:bg-brand-800"
              onMouseDown={(e) => e.preventDefault()} onClick={() => { onAsk(sel.text); setSel(null); }}>
              <Icon name="sparkles" size={15} /> Ask AI
            </button>
            {onHighlight && (
              <button className="flex items-center gap-1.5 border-l border-white/20 px-3 py-2 text-sm font-medium hover:bg-brand-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onHighlight(sel.text); window.getSelection()?.removeAllRanges(); setSel(null); }}>
                <span className="h-3 w-3 rounded-sm bg-accent-400" /> Highlight
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
