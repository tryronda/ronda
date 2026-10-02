// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { installDemoBackend, uninstallDemoBackend } from "../../site/preview/demo";
import type { BookmarkBackup } from "@/workbench/api";
import { BookmarkData } from "./BookmarkData";

test("backup picker keeps conflicts until explicit replacement and rejects malformed files", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  installDemoBackend();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<BookmarkData embedded/>));
    const backup=JSON.parse(await invoke<string>("get_bookmark_backup")) as BookmarkBackup;
    const before=backup.bookmarks[0].note;
    backup.bookmarks[0].note="Imported <b>plain note</b>";
    const picker=host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const importFile=async(json:string)=>{
      Object.defineProperty(picker,"files",{configurable:true,value:[{text:async()=>json}]});
      await act(async()=>picker.dispatchEvent(new Event("change",{bubbles:true})));
    };
    await importFile(JSON.stringify(backup));
    expect(host.textContent).toContain("1 conflicts kept");
    expect(host.textContent).toContain(before);
    expect(host.textContent).toContain(backup.bookmarks[0].note);
    expect(host.querySelector("b")).toBeNull();
    expect(JSON.parse(await invoke<string>("get_bookmark_backup")).bookmarks[0].note).toBe(before);
    await act(async()=>Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="Replace with imported bookmark")!.click());
    expect(host.textContent).toContain("0 conflicts kept");
    expect(JSON.parse(await invoke<string>("get_bookmark_backup")).bookmarks[0].note).toBe(backup.bookmarks[0].note);
    await importFile('{"version":99,"bookmarks":[]}');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Invalid bookmark backup");
    expect(host.textContent).toContain("Changes reset when you reload");
  } finally {await act(async()=>root.unmount());host.remove();uninstallDemoBackend();}
});
