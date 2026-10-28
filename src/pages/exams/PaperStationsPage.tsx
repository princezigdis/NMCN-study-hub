import { Icon } from "../../components/Icon";
import { Badge, Card, DemoBadge, EmptyState, ErrorBox, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { Link, useParams } from "../../lib/router";
import { useAsync } from "../../lib/useAsync";

export default function PaperStationsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => api.paperStations(id), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Paper 4" title="Viva & CAOSCE-style practice"
        subtitle="Work through each station as if an examiner were present, then compare your answers with the marking guide. This is practice feedback, not an official assessment." />
      {!data?.length ? <EmptyState icon="clipboard" title="No stations yet">Stations for this paper are being prepared.</EmptyState> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.map((s) => (
            <Link key={s.id} to={`/station/${s.id}`}>
              <Card className="h-full hover:border-brand-400">
                <div className="flex items-center gap-2">
                  <Badge tone="brand">{s.kind === "viva" ? "Viva" : "CAOSCE"}</Badge>
                  {s.is_demo && <DemoBadge />}
                </div>
                <div className="mt-2 font-semibold">{s.title}</div>
                <div className="ink-2 mt-1 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1"><Icon name="clock" size={14} />{s.duration_minutes} min</span>
                  {s.attempts > 0 && <span>{s.attempts} attempt{s.attempts > 1 ? "s" : ""}</span>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
