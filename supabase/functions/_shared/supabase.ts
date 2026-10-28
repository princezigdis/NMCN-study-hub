// Deno-only: Supabase clients for Edge Functions.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.45.4";
import { HttpError } from "./http.ts";

export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? "";
  if (required && !v) throw new HttpError(503, "not_configured", `Server is missing ${name}`);
  return v;
}

/** Service-role client: bypasses RLS. Use only for checked, server-side operations. */
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the calling user from the Authorization header, plus a client that acts AS them (RLS applies). */
export async function requireUser(req: Request): Promise<{ user: User; userClient: SupabaseClient }> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "not_authenticated");
  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "not_authenticated");
  return { user: data.user, userClient };
}

export async function getSetting<T>(admin: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function flagEnabled(admin: SupabaseClient, key: string): Promise<boolean> {
  const { data } = await admin.from("feature_flags").select("enabled").eq("key", key).maybeSingle();
  return data?.enabled ?? false;
}
