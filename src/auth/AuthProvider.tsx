import type { Session, User } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { AppRole, Profile, Programme } from "../lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  programme: Programme | null;
  programmes: Programme[];
  roles: AppRole[];
  permissions: Set<string>;
  isStaff: boolean;
  can: (permission: string) => boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadUserData = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null); setRoles([]); setPermissions(new Set());
      return;
    }
    const [{ data: prof }, { data: roleRows }, { data: progs }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", s.user.id),
      supabase.from("programmes").select("id, code, name").eq("active", true).order("code"),
    ]);
    setProfile((prof as Profile) ?? null);
    setProgrammes((progs as Programme[]) ?? []);
    const r = ((roleRows ?? []) as Array<{ role: AppRole }>).map((x) => x.role);
    setRoles(r);
    if (r.length) {
      const { data: perms } = await supabase.from("role_permissions").select("permission").in("role", r);
      setPermissions(new Set(((perms ?? []) as Array<{ permission: string }>).map((p) => p.permission)));
    } else setPermissions(new Set());
    supabase.rpc("touch_last_active").then(() => undefined, () => undefined);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadUserData(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Defer to avoid running queries inside the auth callback.
        setTimeout(() => { loadUserData(s); }, 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUserData]);

  const value = useMemo<AuthState>(() => {
    // UI convenience only — every privileged action is re-checked by the database.
    const can = (p: string) => permissions.has("*") || permissions.has(p);
    return {
      loading, session, user: session?.user ?? null, profile, programmes,
      programme: programmes.find((p) => p.id === profile?.programme_id) ?? null,
      roles, permissions, isStaff: roles.length > 0, can,
      refreshProfile: () => loadUserData(session),
      signOut: async () => { await supabase.auth.signOut(); },
    };
  }, [loading, session, profile, programmes, roles, permissions, loadUserData]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
