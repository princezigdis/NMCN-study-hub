import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { AiActionCost, Wallet } from "../../lib/types";
import { api } from "../../lib/api";
import { AIAssistPanel } from "./AIAssistPanel";

export type AssistContextKind = "note" | "question" | "station" | "general";

export interface AssistRequest {
  kind: AssistContextKind;
  text: string;
  noteId?: string;
  topicId?: string | null;
  questionId?: string;
  stationAttemptId?: string;
  title?: string;
  action?: string;          // run immediately
}

interface AICtx {
  open: (req: AssistRequest) => void;
  costs: AiActionCost[];
  wallet: Wallet | null;
  refreshWallet: () => void;
  setWalletBalance: (balance: number) => void;
  enabled: boolean;
}

const Ctx = createContext<AICtx | null>(null);

export function AIProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<AssistRequest | null>(null);
  const [costs, setCosts] = useState<AiActionCost[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [enabled, setEnabled] = useState(true);

  const refreshWallet = useCallback(() => { api.wallet().then(setWallet, () => undefined); }, []);

  useEffect(() => {
    Promise.all([
      supabase.from("ai_action_costs").select("*").eq("enabled", true).order("credits"),
      supabase.from("feature_flags").select("key, enabled"),
    ]).then(([costRes, flagRes]) => {
      const flags = Object.fromEntries(((flagRes.data ?? []) as Array<{ key: string; enabled: boolean }>).map((f) => [f.key, f.enabled]));
      setEnabled(flags.ai_assistant !== false);
      setCosts(((costRes.data ?? []) as AiActionCost[]).filter((x) =>
        (x.action !== "diagram" || flags.ai_images !== false) &&
        (x.action !== "video_search" || flags.video_search !== false) &&
        (x.action !== "web_search" || flags.web_search === true)));
    });
    refreshWallet();
  }, [refreshWallet]);

  const setWalletBalance = useCallback((balance: number) => setWallet((w) => (w ? { ...w, balance } : w)), []);

  return (
    <Ctx.Provider value={{ open: setReq, costs, wallet, refreshWallet, setWalletBalance, enabled }}>
      {children}
      {req && <AIAssistPanel request={req} onClose={() => setReq(null)} />}
    </Ctx.Provider>
  );
}

export function useAI(): AICtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AIProvider missing");
  return c;
}
