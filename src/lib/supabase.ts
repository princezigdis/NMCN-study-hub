import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set (see .env.example). */
export const isConfigured = Boolean(url && anonKey && !url.includes("YOUR-PROJECT-REF"));

// The anon key is public by design; all protection comes from RLS + server RPCs.
export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) ?? "NMCN Study";
