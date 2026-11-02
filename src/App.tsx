import { lazy, type ReactNode, Suspense } from "react";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AIProvider } from "./components/ai/AIContext";
import { AppShell } from "./components/AppShell";
import { Loading, ToastProvider } from "./components/ui";
import { isConfigured } from "./lib/supabase";
import VideosPage from "./pages/dashboard/VideosPage";
import LegalPage from "./pages/legal/LegalPage";
import { Navigate, Router, Routes, type RouteDef, useLocation } from "./lib/router";

import AuthPage from "./pages/auth/AuthPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import OnboardingPage from "./pages/auth/OnboardingPage";
import HomePage from "./pages/HomePage";
import LibraryPage from "./pages/library/LibraryPage";
import CoursePage from "./pages/library/CoursePage";
import NotePage from "./pages/library/NotePage";
import PracticeSetupPage from "./pages/practice/PracticeSetupPage";
import PracticeSessionPage from "./pages/practice/PracticeSessionPage";
import PracticeHistoryPage from "./pages/practice/PracticeHistoryPage";
import ExamSectionPage from "./pages/exams/ExamSectionPage";
import ExamSessionPage from "./pages/exams/ExamSessionPage";
import ExamReviewPage from "./pages/exams/ExamReviewPage";
import PaperStationsPage from "./pages/exams/PaperStationsPage";
import StationPage from "./pages/exams/StationPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import FlashcardsPage from "./pages/dashboard/FlashcardsPage";
import PlannerPage from "./pages/dashboard/PlannerPage";
import ProfilePage from "./pages/dashboard/ProfilePage";
import NotificationsPage from "./pages/dashboard/NotificationsPage";
import SupportPage from "./pages/dashboard/SupportPage";
import MyNotesPage from "./pages/dashboard/MyNotesPage";
import PlansPage from "./pages/plans/PlansPage";
import PaymentCallbackPage from "./pages/plans/PaymentCallbackPage";
import NotFound from "./pages/NotFound";
import { VivaHomePage, VivaProgressPage, VivaReportPage, VivaSessionPage } from "./pages/viva/VivaPages";
import {
  CaosceDashboardPage, CaosceExamSessionPage, CaosceHomePage, CaosceLabPage, CaosceLibraryPage,
  CaosceProcedurePage, CaosceQuestionsPage, CaosceReportPage,
} from "./pages/caosce/CaoscePages";
import { hostSection } from "./lib/lab";
import SetupRequired from "./pages/SetupRequired";

// The admin console is code-split: students never download it.
const AdminApp = lazy(() => import("./pages/admin/AdminApp"));

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) return <Loading label="Starting…" />;
  if (!session) return <Navigate to={`/auth?next=${encodeURIComponent(pathname + search)}`} />;
  if (profile?.status === "suspended") return <Suspended />;
  if (profile && !profile.onboarded && pathname !== "/onboarding") return <Navigate to="/onboarding" />;
  return <>{children}</>;
}

function Suspended() {
  const { signOut } = useAuth();
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-bold">Account suspended</h1>
      <p className="ink-2 mt-2 text-sm">Your account has been suspended. Please contact support if you believe this is a mistake.</p>
      <button onClick={signOut} className="mt-6 text-sm underline">Sign out</button>
    </div>
  );
}

/** Optional subdomain mode: viva.<domain> and caosce.<domain> open their section at "/". */
function RootRoute() {
  const section = hostSection();
  return section ? <Navigate to={`/${section}`} /> : <HomePage />;
}

const shell = (el: ReactNode) => <RequireAuth><AIProvider><AppShell>{el}</AppShell></AIProvider></RequireAuth>;

const routes: RouteDef[] = [
  { path: "/auth", element: <AuthPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/legal/terms", element: <LegalPage kind="terms" /> },
  { path: "/legal/privacy", element: <LegalPage kind="privacy" /> },
  { path: "/legal/credits", element: <LegalPage kind="credits" /> },
  { path: "/legal/refunds", element: <LegalPage kind="refunds" /> },
  { path: "/terms", element: <LegalPage kind="terms" /> },
  { path: "/privacy", element: <LegalPage kind="privacy" /> },
  { path: "/credit-usage", element: <LegalPage kind="credits" /> },
  { path: "/payments-and-refunds", element: <LegalPage kind="refunds" /> },
  { path: "/procedure-videos", element: shell(<VideosPage />) },
  { path: "/onboarding", element: <RequireAuth><OnboardingPage /></RequireAuth> },
  { path: "/", element: shell(<RootRoute />) },
  { path: "/viva", element: shell(<VivaHomePage />) },
  { path: "/viva/progress", element: shell(<VivaProgressPage />) },
  { path: "/viva/session/:id", element: shell(<VivaSessionPage />) },
  { path: "/viva/report/:id", element: shell(<VivaReportPage />) },
  { path: "/caosce", element: shell(<CaosceHomePage />) },
  { path: "/caosce/library", element: shell(<CaosceLibraryPage />) },
  { path: "/caosce/procedure/:id", element: shell(<CaosceProcedurePage />) },
  { path: "/caosce/lab", element: shell(<CaosceLabPage />) },
  { path: "/caosce/questions", element: shell(<CaosceQuestionsPage />) },
  { path: "/caosce/exam/:id", element: <RequireAuth><CaosceExamSessionPage /></RequireAuth> },
  { path: "/caosce/report/:id", element: shell(<CaosceReportPage />) },
  { path: "/caosce/dashboard", element: shell(<CaosceDashboardPage />) },
  { path: "/library", element: shell(<LibraryPage />) },
  { path: "/library/course/:id", element: shell(<CoursePage />) },
  { path: "/library/note/:id", element: shell(<NotePage />) },
  { path: "/practice", element: shell(<PracticeSetupPage />) },
  { path: "/practice/history", element: shell(<PracticeHistoryPage />) },
  { path: "/practice/session/:id", element: shell(<PracticeSessionPage />) },
  { path: "/mock", element: shell(<ExamSectionPage section="C" />) },
  { path: "/final", element: shell(<ExamSectionPage section="D" />) },
  { path: "/exam/:id", element: <RequireAuth><AIProvider><ExamSessionPage /></AIProvider></RequireAuth> },
  { path: "/exam/:id/review", element: shell(<ExamReviewPage />) },
  { path: "/paper/:id/stations", element: shell(<PaperStationsPage />) },
  { path: "/station/:id", element: shell(<StationPage />) },
  { path: "/dashboard", element: shell(<DashboardPage />) },
  { path: "/flashcards", element: shell(<FlashcardsPage />) },
  { path: "/planner", element: shell(<PlannerPage />) },
  { path: "/profile", element: shell(<ProfilePage />) },
  { path: "/notifications", element: shell(<NotificationsPage />) },
  { path: "/support", element: shell(<SupportPage />) },
  { path: "/my-notes", element: shell(<MyNotesPage />) },
  { path: "/videos", element: shell(<VideosPage />) },
  { path: "/plans", element: shell(<PlansPage />) },
  { path: "/payment/callback", element: shell(<PaymentCallbackPage />) },
  { path: "/admin/*", element: <RequireAuth><Suspense fallback={<Loading />}><AdminApp /></Suspense></RequireAuth> },
  { path: "/admin", element: <RequireAuth><Suspense fallback={<Loading />}><AdminApp /></Suspense></RequireAuth> },
];

export default function App() {
  if (!isConfigured) return <SetupRequired />;
  return (
    <ToastProvider>
      <Router>
        <AuthProvider>
          <Routes routes={routes} fallback={shell(<NotFound />)} />
        </AuthProvider>
      </Router>
    </ToastProvider>
  );
}
