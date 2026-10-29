import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ErrorBox, Field, Input } from "../../components/ui";
import { APP_NAME, supabase } from "../../lib/supabase";
import { BASE, useNavigate, useSearchParams } from "../../lib/router";

type Mode = "signin" | "signup" | "forgot";

export default function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) navigate(next.startsWith("/") ? next : "/", { replace: true });
  }, [loading, session, next, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}${BASE}/onboarding` },
        });
        if (error) throw error;
        if (!data.session) setInfo("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${BASE}/reset-password` });
        if (error) throw error;
        setInfo("If an account exists for that email, a reset link is on its way.");
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(/invalid login/i.test(msg) ? "Email or password is incorrect." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><img src="/favicon.svg" alt="" className="h-10 w-10" /><span className="text-xl font-bold">{APP_NAME}</span></div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Prepare for your NMCN exams with confidence.</h1>
          <ul className="mt-8 space-y-3 text-white/90">
            <li>A · Study library organised by course and topic</li>
            <li>B · Practice questions with a rationale for every option</li>
            <li>C · Timed mock examinations (Papers 1–4)</li>
            <li>D · Final examination simulator</li>
            <li>E · Your personal progress dashboard</li>
          </ul>
        </div>
        <p className="text-xs text-white/70">Independent study platform. Not affiliated with or endorsed by the Nursing and Midwifery Council of Nigeria.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div className="lg:hidden"><img src="/favicon.svg" alt="" className="mb-4 h-10 w-10" /></div>
          <div>
            <h2 className="text-2xl font-bold">{mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}</h2>
            <p className="ink-2 mt-1 text-sm">{mode === "signup" ? "Free to start — includes AI credits every month." : mode === "signin" ? "Sign in to continue studying." : "We'll email you a secure link."}</p>
          </div>
          {error && <ErrorBox message={error} />}
          {info && <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-900/50 dark:text-brand-100">{info}</div>}
          {mode === "signup" && (
            <Field label="Full name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />}</Field>
          )}
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />}</Field>
          {mode !== "forgot" && (
            <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>{(id) => (
              <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            )}</Field>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </Button>
          <div className="ink-2 flex justify-between text-sm">
            {mode === "signin" ? (
              <>
                <button type="button" className="underline" onClick={() => setMode("forgot")}>Forgot password?</button>
                <button type="button" className="font-semibold text-brand-700 dark:text-brand-300" onClick={() => setMode("signup")}>Create account</button>
              </>
            ) : (
              <button type="button" className="underline" onClick={() => setMode("signin")}>Back to sign in</button>
            )}
          </div>
          {mode === "signup" && (
            <p className="ink-2 text-xs">By creating an account you agree to use the content for personal study. AI features process the text you select; never enter patient-identifiable information.</p>
          )}
        </form>
      </div>
    </div>
  );
}
