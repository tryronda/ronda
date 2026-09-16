import { IntelligenceView } from "@/panels/IntelligenceView";
import { installDemoBackend } from "../preview/demo";

installDemoBackend();

/** The app's real Intelligence view, running on the preview's sample data. Evidence links open the full preview. */
export default function LiveReport() {
  return <div className="bg-background [&_.ronda-panel]:h-auto [&_.ronda-panel]:overflow-visible">
    <IntelligenceView onOpen={() => { window.location.href = `${import.meta.env.BASE_URL}#preview`; }} />
  </div>;
}
