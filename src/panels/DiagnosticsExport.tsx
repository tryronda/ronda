import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { inTauri, invoke } from "@/lib/tauri";

type DiagnosticsReport = {
  format_version: number;
  app_version: string;
  schema_version: number;
  generated_at: string;
  index_available: boolean;
  session_count: number;
  sources: { configured: number; enabled: number; available: number };
};

export function DiagnosticsExport({ embedded = false }: { embedded?: boolean }) {
  const native = inTauri() && !embedded;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const json = report ? JSON.stringify(report, null, 2) : "";

  return <div className="mt-6 border-t border-border pt-5" aria-label="Diagnostics report">
    <h3>Diagnostics report</h3>
    <p className="panel-help">Review an allowlisted report before saving. It contains app and index versions, aggregate session and local source counts, and whether the index is available. It has no paths, source names, transcript content, credentials, or remote sync details. Ronda does not send it anywhere.</p>
    {embedded && <p className="panel-help">This preview uses fixed synthetic values. The downloaded JSON is a sample and resets when you reload the page.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        setReport(null);
        setReport(await invoke<DiagnosticsReport>("get_diagnostics_report"));
        setNotice("Review the report fields before saving");
      })}>{report ? "Refresh report preview" : "Preview diagnostics report"}</button>
      {report && <button type="button" disabled={busy} onClick={() => void run(async () => {
        if (native) {
          const destination = await save({defaultPath:"ronda-diagnostics.json",filters:[{name:"Diagnostics report",extensions:["json"]}]});
          if (!destination) return;
          await invoke("export_diagnostics", {destination,report});
        } else {
          const url = URL.createObjectURL(new Blob([json],{type:"application/json"}));
          const link = document.createElement("a"); link.href=url; link.download="ronda-diagnostics.json";
          link.click(); URL.revokeObjectURL(url);
        }
        setNotice("Diagnostics report saved");
      })}>Save JSON report</button>}
    </div>
    {notice && <p className="panel-help mt-3" role="status">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-destructive">{error}</p>}
    {report && <div className="mt-4">
      <p className="panel-help">This is the exact JSON that will be saved. Available sources counts enabled local source folders that currently exist as directories; it does not measure parsing or remote sync health.</p>
      <pre aria-label="Diagnostics report JSON" className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border p-3 text-xs"><code>{json}</code></pre>
    </div>}
  </div>;
}
