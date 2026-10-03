// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { installDemoBackend, uninstallDemoBackend } from "../../site/preview/demo";
import { inTauri, invoke } from "@/lib/tauri";
import { DiagnosticsExport } from "./DiagnosticsExport";

test("shows and downloads the same allowlisted synthetic JSON, keeping the preview after a save failure", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  installDemoBackend();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const blobs: Blob[]=[];
  const originalCreate=URL.createObjectURL;
  const originalRevoke=URL.revokeObjectURL;
  URL.createObjectURL=(blob:Blob)=>{blobs.push(blob);return "blob:diagnostics";};
  URL.revokeObjectURL=()=>{};
  const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  const clickButton=async(label:string)=>act(async()=>{
    Array.from(host.querySelectorAll("button")).find(button=>button.textContent===label)!.click();
    await new Promise(resolve=>setTimeout(resolve,0));
  });
  try {
    await invoke("set_pref", { key: "saved_searches_v1", value: "private-query-and-project-path-canary" });
    const expected=await invoke("get_diagnostics_report");
    await act(async()=>root.render(<DiagnosticsExport embedded/>));
    await clickButton("Preview diagnostics report");
    const displayed=host.querySelector("pre code")?.textContent ?? "";
    const report=JSON.parse(displayed) as Record<string,unknown>;
    expect(report).toEqual(expected);
    expect(Object.keys(report)).toEqual(["format_version","app_version","schema_version","generated_at","index_available","session_count","sources"]);
    expect(JSON.stringify(report)).not.toMatch(/\/Users\/|secret|transcript|buildbox|token|project/iu);
    expect(JSON.stringify(report)).not.toContain("private-query-and-project-path-canary");
    URL.createObjectURL=()=>{throw new Error("synthetic save failure");};
    await clickButton("Save JSON report");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("synthetic save failure");
    expect(host.querySelector("pre code")?.textContent).toBe(displayed);
    URL.createObjectURL=(blob:Blob)=>{blobs.push(blob);return "blob:diagnostics";};
    await clickButton("Save JSON report");
    expect(click).toHaveBeenCalledOnce();
    expect(JSON.parse(await blobs[0].text())).toEqual(report);
    expect(host.querySelector("pre code")?.textContent).toBe(displayed);
  } finally {
    click.mockRestore();URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;
    await act(async()=>root.unmount());host.remove();uninstallDemoBackend();
  }
});
