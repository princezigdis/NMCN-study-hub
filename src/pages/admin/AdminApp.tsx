import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { toggleTheme } from "../../components/AppShell";
import { Icon, type IconName } from "../../components/Icon";
import { cx, EmptyState, Button } from "../../components/ui";
import { Link, NavLink, Routes, useLocation } from "../../lib/router";
import AdminOverview from "./AdminOverview";
import AdminCurriculum from "./AdminCurriculum";
import AdminNoteEditor from "./AdminNoteEditor";
import AdminQuestions from "./AdminQuestions";
import AdminQuestionEditor from "./AdminQuestionEditor";
import AdminImport from "./AdminImport";
import AdminExams from "./AdminExams";
import AdminPoolEditor from "./AdminPoolEditor";
import AdminStations from "./AdminStations";
import AdminUsers from "./AdminUsers";
import AdminAI from "./AdminAI";
import AdminPayments from "./AdminPayments";
import AdminReports from "./AdminReports";
import AdminAudit from "./AdminAudit";
import AdminSettings from "./AdminSettings";

const NAV: Array<{ to: string; label: string; icon: IconName; perm?: string[] }> = [
  { to: "/admin", label: "Overview", icon: "chart" },
  { to: "/admin/curriculum", label: "Curriculum & notes", icon: "book", perm: ["content.manage", "content.review"] },
  { to: "/admin/questions", label: "Questions", icon: "quiz", perm: ["questions.manage", "questions.review"] },
  { to: "/admin/import", label: "Bulk import", icon: "upload", perm: ["questions.manage"] },
  { to: "/admin/exams", label: "Exams (C & D)", icon: "clipboard", perm: ["exams.manage"] },
  { to: "/admin/stations", label: "Viva & CAOSCE", icon: "award", perm: ["exams.manage"] },
  { to: "/admin/users", label: "Users & access", icon: "user", perm: ["users.view"] },
  { to: "/admin/ai", label: "AI & plans", icon: "sparkles", perm: ["ai.manage", "pricing.manage"] },
  { to: "/admin/payments", label: "Payments", icon: "lock", perm: ["payments.view"] },
  { to: "/admin/reports", label: "Reports & support", icon: "flag", perm: ["reports.manage", "support.manage"] },
  { to: "/admin/audit", label: "Audit log", icon: "shield", perm: ["audit.view"] },
  { to: "/admin/settings", label: "Settings & roles", icon: "settings", perm: ["settings.manage", "roles.manage", "notifications.send"] },
];

/**
 * Admin console. Navigation is filtered by permission for convenience only;
 * every query and RPC behind these screens is enforced by RLS / server checks.
 */
export default function AdminApp() {
  const { isStaff, can, roles, profile } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (!isStaff) {
    return <div className="p-6"><EmptyState icon="lock" title="Admins only" action={<Link to="/"><Button>Back to app</Button></Link>}>Your account doesn't have an admin role.</EmptyState></div>;
  }
  const items = NAV.filter((n) => !n.perm || n.perm.some(can));

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className={cx("surface fixed inset-y-0 left-0 z-40 w-64 flex-col border-r line lg:flex", open ? "flex" : "hidden")}>
        <div className="flex items-center gap-2 px-5 py-5">
          <Icon name="shield" className="text-brand-600" />
          <span className="font-bold">Admin console</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" onClick={() => setOpen(false)}>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} exact={n.to === "/admin"} className={(a) => cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              a ? "bg-brand-700 text-white" : "hover:bg-[var(--surface-2)]")}>
              <Icon name={n.icon} size={18} />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t line p-4 text-xs">
          <div className="font-medium">{profile?.full_name || profile?.email}</div>
          <div className="ink-2">{roles.map((r) => r.replace("_", " ")).join(", ")}</div>
          <div className="mt-3 flex gap-3"><Link to="/" className="underline">Student view</Link><button onClick={toggleTheme} className="underline">Theme</button></div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <header className="surface sticky top-0 z-20 flex h-12 items-center gap-2 border-b line px-4 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open admin menu"><Icon name="menu" /></button>
        <span className="font-semibold">Admin</span>
        <span className="ink-2 truncate text-xs">{pathname}</span>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Routes fallback={<EmptyState title="Not found" />} routes={[
          { path: "/admin", element: <AdminOverview /> },
          { path: "/admin/curriculum", element: <AdminCurriculum /> },
          { path: "/admin/notes/:id", element: <AdminNoteEditor /> },
          { path: "/admin/questions", element: <AdminQuestions /> },
          { path: "/admin/questions/new", element: <AdminQuestionEditor /> },
          { path: "/admin/questions/:id", element: <AdminQuestionEditor /> },
          { path: "/admin/import", element: <AdminImport /> },
          { path: "/admin/exams", element: <AdminExams /> },
          { path: "/admin/pools/:id", element: <AdminPoolEditor /> },
          { path: "/admin/stations", element: <AdminStations /> },
          { path: "/admin/stations/:id", element: <AdminStations /> },
          { path: "/admin/users", element: <AdminUsers /> },
          { path: "/admin/users/:id", element: <AdminUsers /> },
          { path: "/admin/ai", element: <AdminAI /> },
          { path: "/admin/payments", element: <AdminPayments /> },
          { path: "/admin/reports", element: <AdminReports /> },
          { path: "/admin/audit", element: <AdminAudit /> },
          { path: "/admin/settings", element: <AdminSettings /> },
        ]} />
      </main>
    </div>
  );
}
