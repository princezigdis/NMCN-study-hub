import { Card, ErrorBox, Loading, PageHeader, Stat } from "../../components/ui";
import { rpc } from "../../lib/api";
import { naira, pct } from "../../lib/format";
import { Link } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";

interface Overview {
  users_total: number; users_active_7d: number; users_suspended: number; by_programme: Record<string, number>;
  courses: number; notes_published: number; notes_in_review: number; questions: Record<string, number>;
  exam_attempts_30d: number; exam_avg_percent_30d: number | null; ai_requests_30d: number; ai_failures_30d: number;
  ai_cost_usd_30d: number; ai_cost_usd_today: number; subscriptions: Record<string, number>; entitlements: Record<string, number>;
  revenue_kobo_30d: number; payments_failed_30d: number; open_reports: number; open_tickets: number;
}

export default function AdminOverview() {
  const { data, error, loading, reload } = useAsync(() => rpc<Overview>("admin_overview"), []);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "Could not load"} onRetry={reload} />;
  const q = data.questions;
  const qCount = (bank: string, status = "published") => q[`${bank}:${status}`] ?? 0;
  const qInReview = Object.entries(q).filter(([k]) => k.endsWith(":in_review")).reduce((s, [, v]) => s + v, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Live figures from the database." />
      <section>
        <h2 className="ink-2 mb-2 text-xs font-semibold uppercase tracking-wide">Students</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Registered" value={data.users_total} />
          <Stat label="Active (7 days)" value={data.users_active_7d} />
          <Stat label="RN / RM" value={`${data.by_programme.RN ?? 0} / ${data.by_programme.RM ?? 0}`} hint={`${data.by_programme.unset ?? 0} not set`} />
          <Stat label="Suspended" value={data.users_suspended} />
        </div>
      </section>
      <section>
        <h2 className="ink-2 mb-2 text-xs font-semibold uppercase tracking-wide">Content</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Published courses" value={data.courses} />
          <Stat label="Published notes" value={data.notes_published} hint={<Link to="/admin/curriculum" className="underline">{data.notes_in_review} versions awaiting review</Link>} />
          <Stat label="Practice questions" value={qCount("practice")} hint={`C: ${qCount("section_c")} · D: ${qCount("section_d")}`} />
          <Stat label="Questions in review" value={qInReview} hint={<Link to="/admin/questions?status=in_review" className="underline">Review now</Link>} />
        </div>
      </section>
      <section>
        <h2 className="ink-2 mb-2 text-xs font-semibold uppercase tracking-wide">Exams, AI & revenue (30 days)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Exam attempts" value={data.exam_attempts_30d} hint={`Average ${pct(data.exam_avg_percent_30d)}`} />
          <Stat label="AI requests" value={data.ai_requests_30d} hint={`${data.ai_failures_30d} failed (refunded)`} />
          <Stat label="Est. AI cost" value={`$${Number(data.ai_cost_usd_30d).toFixed(2)}`} hint={`Today $${Number(data.ai_cost_usd_today).toFixed(2)}`} />
          <Stat label="Revenue" value={naira(data.revenue_kobo_30d)} hint={`${data.payments_failed_30d} failed / mismatched payments`} />
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="mb-2 font-semibold">Active exam access</h3>
          <p className="text-sm">Section C: <b>{data.entitlements.section_c ?? 0}</b></p>
          <p className="text-sm">Section D: <b>{data.entitlements.section_d ?? 0}</b></p>
        </Card>
        <Card>
          <h3 className="mb-2 font-semibold">Paid AI plans</h3>
          {["standard", "pro", "ultra"].map((p) => <p key={p} className="text-sm capitalize">{p}: <b>{data.subscriptions[p] ?? 0}</b></p>)}
        </Card>
        <Card>
          <h3 className="mb-2 font-semibold">Needs attention</h3>
          <p className="text-sm"><Link to="/admin/reports" className="underline">{data.open_reports} open content reports</Link></p>
          <p className="text-sm"><Link to="/admin/reports?tab=tickets" className="underline">{data.open_tickets} open support tickets</Link></p>
        </Card>
      </div>
    </div>
  );
}
