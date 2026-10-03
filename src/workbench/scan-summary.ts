import type { ScanReport } from "./api";

export function scanSummary(report: ScanReport): string {
  const counts = `session sources discovered: ${report.discovered}; sessions indexed: ${report.indexed}; sessions unchanged: ${report.unchanged}`;
  if (report.errors.length > 0) return `Partial local scan — ${counts}; scan errors: ${report.errors.length}.`;
  if (report.discovered === 0 && report.indexed === 0 && report.unchanged === 0) {
    return `No local sessions discovered. Local scan complete — ${counts}.`;
  }
  return `Local scan complete — ${counts}.`;
}
