import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { APP_NAME, supabase } from "../lib/supabase";
import { Link, NavLink, useLocation } from "../lib/router";
import { useAI } from "./ai/AIContext";
import { Icon, type IconName } from "./Icon";
import { cx } from "./ui";

const SECTIONS: Array<{ to: string; letter: string; label: string; short: string; icon: IconName }> = [
  { to: "/library", letter: "A", label: "Study Library", short: "Library", icon: "book" },
  { to: "/practice", letter: "B", label: "Question Bank", short: "Questions", icon: "quiz" },
  { to: "/mock", letter: "C", label: "Mock Exam", short: "Mock", icon: "clipboard" },
  { to: "/final", letter: "D", label: "Final Exam", short: "Final", icon: "award" },
  { to: "/dashboard", letter: "E", label: "My Dashboard", short: "Me", icon: "chart" },
];

const BOTTOM_TABS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/flashcards", label: "Flashcards", icon: "cards" },
  { to: "/plans", label: "AI Plan", icon: "sparkles" },
  { to: "/procedure-videos", label: "Videos", icon: "video" },
];

export function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, programme, isStaff, signOut } = useAuth();
  const { wallet } = useAI();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const [banner, setBanner] = useState(false);
  const [site, setSite] = useState<{ banner?: { visible?: boolean; text?: string; tone?: string }; maintenance?: { enabled?: boolean; message?: string } }>({});

  useEffect(() => {
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)
      .then(({ count }) => setUnread(count ?? 0));
    supabase.rpc("site_state").then(({ data }) => { if (data) setSite(data as typeof site); });
    supabase.from("feature_flags").select("enabled").eq("key", "maintenance_banner").maybeSingle()
      .then(({ data }) => setBanner(Boolean(data?.enabled)));
  }, [pathname]);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    const onClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-menu-root]")) setMenu(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [menu]);

  if (site.maintenance?.enabled && !isStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-xl font-bold">We'll be right back</h1>
          <p className="ink-2 mt-2 text-sm">{site.maintenance.message || "We are making improvements and will be back shortly."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="surface fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r line lg:flex">
        <Link to="/" className="flex items-center gap-2 px-5 py-5">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
        </Link>
        {programme && <div className="mx-5 mb-3 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/60 dark:text-brand-100">{programme.name} ({programme.code})</div>}
        <nav className="flex-1 space-y-1 px-3" aria-label="Sections">
          <NavLink to="/" exact className={(a) => navCls(a)}><Icon name="home" size={18} />Home</NavLink>
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} className={(a) => navCls(a)}>
              <span className={cx("flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold", "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100")}>{s.letter}</span>
              {s.label}
            </NavLink>
          ))}
          <div className="pt-4" />
          <NavLink to="/viva" className={(a) => navCls(a)}><Icon name="mic" size={18} />Viva Lab</NavLink>
          <NavLink to="/caosce" className={(a) => navCls(a)}><Icon name="activity" size={18} />CAOSCE Lab</NavLink>
          <NavLink to="/flashcards" className={(a) => navCls(a)}><Icon name="cards" size={18} />Flashcards</NavLink>
          <NavLink to="/planner" className={(a) => navCls(a)}><Icon name="calendar" size={18} />Study planner</NavLink>
          <NavLink to="/videos" className={(a) => navCls(a)}><Icon name="video" size={18} />Procedure videos</NavLink>
          <NavLink to="/plans" className={(a) => navCls(a)}><Icon name="sparkles" size={18} />AI plans</NavLink>
          <NavLink to="/support" className={(a) => navCls(a)}><Icon name="quiz" size={18} />Help & support</NavLink>
          {isStaff && <NavLink to="/admin" className={(a) => navCls(a)}><Icon name="shield" size={18} />Admin console</NavLink>}
          <div className="ink-2 flex flex-wrap gap-x-3 gap-y-1 px-3 pt-4 text-[11px]">
            <Link to="/legal/terms" className="underline">Terms</Link><Link to="/legal/privacy" className="underline">Privacy</Link>
            <Link to="/legal/credits" className="underline">Credits</Link><Link to="/legal/refunds" className="underline">Refunds</Link>
          </div>
        </nav>
        <div className="border-t line p-3">
          <Link to="/profile" className="flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--surface-2)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">{initials(profile?.full_name ?? profile?.email)}</span>
            <span className="min-w-0 text-sm"><span className="block truncate font-medium">{profile?.full_name || "My profile"}</span><span className="ink-2 block truncate text-xs">{profile?.email}</span></span>
          </Link>
        </div>
      </aside>

      {/* Top bar */}
      <header className="surface sticky top-0 z-20 flex h-14 items-center gap-2 border-b line px-4">
        <Link to="/" className="flex items-center gap-2 lg:hidden">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" /><span className="hidden whitespace-nowrap font-bold min-[420px]:inline">{APP_NAME}</span>
        </Link>
        <div className="flex-1" />
        {wallet && (
          <Link to="/plans" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent-400/20 px-3 py-1 text-xs font-semibold text-accent-600 dark:text-accent-400" title="AI credits remaining">
            <Icon name="sparkles" size={14} />{wallet.balance} credits
          </Link>
        )}
        <Link to="/notifications" className="relative rounded-lg p-2 hover:bg-[var(--surface-2)]" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Icon name="bell" />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
        </Link>
        <button onClick={toggleTheme} className="rounded-lg p-2 hover:bg-[var(--surface-2)]" aria-label="Toggle dark mode">
          <Icon name="moon" className="dark:hidden" /><Icon name="sun" className="hidden dark:block" />
        </button>
        <div className="relative lg:hidden" data-menu-root>
          <button onClick={() => setMenu((m) => !m)} className="rounded-lg p-2 hover:bg-[var(--surface-2)]" aria-label="Menu" aria-expanded={menu}><Icon name="menu" /></button>
          {menu && (
            <div className="surface absolute right-0 top-11 w-56 rounded-xl border line p-1 shadow-xl">
              {[["/profile", "Profile"], ["/library", "A · Study Library"], ["/practice", "B · Question Bank"], ["/mock", "C · Mock Exam"], ["/final", "D · Final Exam"], ["/dashboard", "E · My Dashboard"], ["/viva", "Viva Lab"], ["/caosce", "CAOSCE Lab"], ["/flashcards", "Flashcards"], ["/planner", "Study planner"], ["/videos", "Procedure videos"], ["/plans", "AI plans"], ["/support", "Help & support"], ["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/credits", "Credit usage"], ["/legal/refunds", "Payments & refunds"]].map(([to, l]) => (
                <Link key={to} to={to} className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--surface-2)]">{l}</Link>
              ))}
              {isStaff && <Link to="/admin" className="block rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-[var(--surface-2)]">Admin console</Link>}
              <button onClick={signOut} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-[var(--surface-2)]">Sign out</button>
            </div>
          )}
        </div>
        <button onClick={signOut} className="hidden items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)] lg:inline-flex"><Icon name="logout" size={16} />Sign out</button>
      </header>

      {site.banner?.visible && site.banner.text && (
        <div role="status" className={cx("px-4 py-2 text-center text-sm", site.banner.tone === "warning" ? "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" : "bg-brand-50 text-brand-900 dark:bg-brand-900/50 dark:text-brand-100")}>{site.banner.text}</div>
      )}
      {banner && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">Scheduled maintenance is in progress. Some features may be briefly unavailable.</div>}

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-12">{children}</main>

      {/* Mobile bottom tabs */}
      <nav className="surface fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t line safe-bottom lg:hidden" aria-label="Main">
        {BOTTOM_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} exact={t.to === "/"} className={(a) => cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", a ? "text-brand-700 dark:text-brand-300" : "ink-2")}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function navCls(active: boolean) {
  return cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    active ? "bg-brand-700 text-white [&_span]:bg-white/20 [&_span]:text-white" : "hover:bg-[var(--surface-2)]");
}

function initials(s?: string | null) {
  if (!s) return "?";
  return s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}
