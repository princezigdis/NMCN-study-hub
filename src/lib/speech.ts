import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SR: any = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

export const speechSupported = Boolean(SR);
export const speakSupported = typeof window !== "undefined" && "speechSynthesis" in window;

/** Browser speech-to-text. Audio is handled by the browser; nothing is stored by us. */
export function useDictation(onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<any>(null);
  const base = useRef("");
  useEffect(() => () => { try { rec.current?.stop(); } catch { /* ignore */ } }, []);

  const start = useCallback((existing: string) => {
    if (!SR) { setError("Voice answers are not supported in this browser. Use Chrome, or type your answer."); return; }
    setError(null); base.current = existing ? existing.trimEnd() + " " : "";
    const r = new SR();
    r.lang = "en-NG"; r.continuous = true; r.interimResults = true;
    r.onresult = (e: any) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      onText(base.current + txt);
    };
    r.onerror = (e: any) => {
      setListening(false);
      setError(e.error === "not-allowed" ? "Microphone permission was blocked. Allow it in your browser, or type your answer." : e.error === "no-speech" ? "I did not hear anything. Try again." : "Voice input failed. You can type your answer.");
    };
    r.onend = () => setListening(false);
    rec.current = r; setListening(true);
    try { r.start(); } catch { setListening(false); }
  }, [onText]);
  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* ignore */ } setListening(false); }, []);
  return { listening, error, start, stop };
}

export function speak(text: string, onEnd?: () => void) {
  if (!speakSupported) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-NG"; u.rate = 0.95;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}
export const stopSpeaking = () => { if (speakSupported) window.speechSynthesis.cancel(); };

/** Countdown from a server deadline, corrected for clock skew. */
export function useCountdown(deadlineIso: string | null | undefined, serverNowIso: string | null | undefined) {
  const skew = useRef(0);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadlineIso) { setLeft(null); return; }
    skew.current = serverNowIso ? new Date(serverNowIso).getTime() - Date.now() : 0;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(deadlineIso).getTime() - (Date.now() + skew.current)) / 1000)));
    tick(); const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [deadlineIso, serverNowIso]);
  return left;
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
