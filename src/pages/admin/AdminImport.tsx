import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Card, ErrorBox, PageHeader, Select, useToast } from "../../components/ui";
import { rpc } from "../../lib/api";
import { downloadText, parseCsv, QUESTION_COLUMNS, QUESTION_TEMPLATE, rowsToObjects, type ValidatedRow, validateQuestionRows } from "../../lib/csv";
import { friendly } from "../../lib/errors";

interface Report { dry_run: boolean; inserted: Array<{ row: number; id?: string }>; duplicates: Array<{ row: number; existing_id: string; similarity: number }>; errors: Array<{ row: number; error: string }> }

export default function AdminImport() {
  const { can } = useAuth();
  const toast = useToast();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [status, setStatus] = useState("draft");
  const [skipDupes, setSkipDupes] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast("CSV must be under 5 MB", "error");
    const text = await file.text();
    const { rows: objs, unknownColumns } = rowsToObjects(parseCsv(text));
    if (objs.length > 2000) return toast("Import at most 2,000 rows at a time", "error");
    setFileName(file.name); setUnknown(unknownColumns); setRows(validateQuestionRows(objs)); setReport(null);
  };

  const valid = rows.filter((r) => !r.errors.length);
  const run = async (dry: boolean) => {
    setBusy(true);
    try {
      const r = await rpc<Report>("admin_import_questions", { p_rows: valid.map((v) => v.row), p_status: status, p_skip_duplicates: skipDupes, p_dry_run: dry });
      // Server rows are numbered within the valid subset; map back to file rows.
      const map = (n: number) => valid[n - 1]?.index ?? n;
      setReport({ ...r, inserted: r.inserted.map((x) => ({ ...x, row: map(x.row) })), duplicates: r.duplicates.map((x) => ({ ...x, row: map(x.row) })), errors: r.errors.map((x) => ({ ...x, row: map(x.row) })) });
      if (!dry) toast(`${r.inserted.length} questions imported`);
    } catch (e) { toast(friendly(e), "error"); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="Bulk import questions" subtitle="Upload a CSV (save from Excel or Google Sheets as CSV UTF-8). Rows are checked here, then again on the server."
        actions={<Button variant="secondary" icon="download" onClick={() => downloadText("question-import-template.csv", QUESTION_TEMPLATE)}>Download template</Button>} />

      <Card className="mb-4 space-y-3">
        <p className="ink-2 text-sm">Columns: <code className="text-xs">{QUESTION_COLUMNS.join(", ")}</code>. <b>topic_title</b> must match an existing topic (optionally narrowed by <b>course_code</b>). <b>correct</b> is a letter A–E. <b>programmes</b> is RN, RM or RN,RM.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white">
          Choose CSV file<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        {fileName && <span className="ml-3 text-sm">{fileName}: {rows.length} rows · <b className="text-emerald-700">{valid.length} valid</b> · <b className="text-red-600">{rows.length - valid.length} with errors</b></span>}
        {unknown.length > 0 && <ErrorBox message={`Unknown columns ignored: ${unknown.join(", ")}`} />}
      </Card>

      {rows.length > 0 && (
        <>
          <Card className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm">Import as
              <Select className="ml-2 inline-block w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="draft">Draft</option><option value="in_review">In review</option>
                {can("questions.review") && <option value="published">Published (reviewed)</option>}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} />Skip likely duplicates (≥85% similar)</label>
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => run(true)} loading={busy} disabled={!valid.length}>Check on server (dry run)</Button>
            <Button onClick={() => run(false)} loading={busy} disabled={!valid.length}>Import {valid.length} rows</Button>
          </Card>

          {report && (
            <Card className="mb-4">
              <h2 className="mb-2 font-semibold">{report.dry_run ? "Dry run result" : "Import result"}</h2>
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge tone="success">{report.inserted.length} {report.dry_run ? "would import" : "imported"}</Badge>
                <Badge tone="warning">{report.duplicates.length} possible duplicates</Badge>
                <Badge tone="danger">{report.errors.length} rejected</Badge>
              </div>
              {report.errors.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-red-700">{report.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}
              {report.duplicates.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{report.duplicates.map((d) => <li key={d.row}>Row {d.row}: {Math.round(d.similarity * 100)}% similar to <a className="underline" href={`/admin/questions/${d.existing_id}`}>an existing question</a></li>)}</ul>}
            </Card>
          )}

          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full text-sm">
              <thead className="surface-2 ink-2 text-left text-xs uppercase"><tr><th className="p-2">Row</th><th>Stem</th><th>Topic</th><th>Answer</th><th>Checks</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.index} className="border-t line align-top">
                    <td className="p-2">{r.index}</td>
                    <td className="max-w-md py-2 pr-2">{r.row.stem?.slice(0, 140)}</td>
                    <td className="ink-2 py-2">{r.row.topic_title}</td>
                    <td className="py-2">{r.row.correct}</td>
                    <td className="py-2 text-xs">
                      {r.errors.map((e) => <div key={e} className="text-red-600">✕ {e}</div>)}
                      {r.warnings.map((w) => <div key={w} className="text-amber-700 dark:text-amber-300">! {w}</div>)}
                      {!r.errors.length && !r.warnings.length && <span className="text-emerald-700">✓ OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
