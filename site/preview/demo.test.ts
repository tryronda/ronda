// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { backend, queryDefaults, type BookmarkBackup, type BookmarkImport } from "@/workbench/api";
import { appendDemoMessage, installDemoBackend, uninstallDemoBackend } from "./demo";

afterEach(uninstallDemoBackend);

test("bookmark preview preserves snapshots and notes through conflicts, invalid imports, and round trips", async () => {
  installDemoBackend();
  const views = await backend.listBookmarks("",queryDefaults);
  expect(views.map(view=>view.status).sort()).toEqual(["changed","current","unavailable"]);
  const current = views.find(view=>view.status === "current")!.bookmark;
  const saved = await backend.saveBookmark(current.session_key,current.seq,"Plain <b>note</b>",false,current.updated_at);
  await expect(backend.saveBookmark(current.session_key,current.seq,"stale",false,current.updated_at)).rejects.toThrow("changed");
  const repeats = await Promise.all([backend.saveBookmark(current.session_key,current.seq,"",false,null),backend.saveBookmark(current.session_key,current.seq,"",false,null)]);
  expect(repeats.map(bookmark=>bookmark.note)).toEqual([saved.note,saved.note]);
  const backup = JSON.parse(await invoke<string>("get_bookmark_backup")) as BookmarkBackup;
  const incoming = structuredClone(backup);
  incoming.bookmarks.find(bookmark=>bookmark.session_key===saved.session_key && bookmark.seq===saved.seq)!.note = "Imported note";
  const apply = (data: BookmarkBackup, replacements: unknown[] = []) => invoke<BookmarkImport>("import_bookmarks",{json:JSON.stringify(data),replacements});
  const conflict = await apply(incoming);
  expect(conflict.conflicts).toHaveLength(1);
  expect(conflict.conflicts[0].existing.note).toBe(saved.note);
  const invalid = structuredClone(incoming);
  invalid.bookmarks.push({...saved,session_key:"new:bookmark",text_hash:"invalid"});
  await expect(apply(invalid)).rejects.toThrow("Invalid bookmark");
  expect(JSON.parse(await invoke<string>("get_bookmark_backup"))).toEqual(backup);
  const replacement = {session_key:saved.session_key,seq:saved.seq,expected_updated_at:saved.updated_at};
  expect((await apply(incoming,[{...replacement,expected_updated_at:current.updated_at}])).conflicts).toHaveLength(1);
  expect((await apply(incoming,[replacement])).imported).toBe(1);
  expect((await apply(incoming)).conflicts).toHaveLength(0);
  const unavailable = views.find(view=>view.status==="unavailable")!.bookmark;
  await backend.saveBookmark(unavailable.session_key,unavailable.seq,"Retained without source",false,unavailable.updated_at);
  await expect(backend.saveBookmark(unavailable.session_key,unavailable.seq,"",true,null)).rejects.toThrow();
  const exported = JSON.parse(await invoke<string>("get_bookmark_backup")) as BookmarkBackup;
  for (const bookmark of exported.bookmarks) await backend.deleteBookmark(bookmark.session_key,bookmark.seq);
  expect(await backend.listBookmarks("",queryDefaults)).toHaveLength(0);
  expect((await apply(exported)).imported).toBe(exported.bookmarks.length);
  expect(JSON.parse(await invoke<string>("get_bookmark_backup"))).toEqual(exported);
  expect(await backend.listBookmarks("retained source",queryDefaults)).toHaveLength(1);
});

test("sample messages update the real workbench backend and notify subscribed readers", async () => {
  installDemoBackend();
  const changed = vi.fn();
  const stop = await backend.onLibraryChanged(changed);
  const before = await backend.getTranscript("claude-code:demo-0");
  const originalLength = before.length;
  appendDemoMessage();
  const after = await backend.getTranscript("claude-code:demo-0");
  expect(after).toHaveLength(originalLength + 1);
  expect(after.at(-1)?.text).toContain("Sample update");
  expect(changed).toHaveBeenCalledTimes(1);
  stop(); appendDemoMessage(); expect(changed).toHaveBeenCalledTimes(1);
  await expect(invoke("unknown_preview_command")).rejects.toThrow("Unsupported preview command");
});

test("preview groups title and message matches, sorts, pages, and honors filters", async () => {
  installDemoBackend();
  const { queryDefaults } = await import("@/workbench/api");
  const first = await backend.searchGrouped("pagination", queryDefaults, "relevance", 0, 50);
  expect(first.groups).toHaveLength(50);
  expect(first.total_sessions).toBe(54);
  expect(first.total_message_matches).toBe(78);
  const second = await backend.searchGrouped("pagination", queryDefaults, "recent", 50, 50);
  expect(second.groups).toHaveLength(4);
  expect(new Set([...first.groups,...second.groups].map(group=>group.session.key)).size).toBe(54);
  const matches = await backend.searchSessionMatches("pagination", queryDefaults, "codex:pagination-0", 20, 20);
  expect(matches.total_matches).toBe(25);expect(matches.matches).toHaveLength(5);expect(matches.matches[0].seq).toBe(20);
  const archived = await backend.searchGrouped("pagination", {...queryDefaults,include_archived:true}, "recent", 0, 100);
  expect(archived.total_sessions).toBe(55);
  const title = await backend.searchGrouped("refunds endpoint",queryDefaults,"relevance",0,50);
  expect(title.groups[0].title_match).toBe(true);expect(title.groups[0].message_matches).toBe(0);
  const code = await backend.searchGrouped("USEEFFECT(",queryDefaults,"relevance",0,50);
  expect(code.groups[0].excerpts.length).toBeGreaterThan(1);
  const filter = await backend.searchGrouped("pagination", {...queryDefaults, agent:"cursor"},"recent",0,50);
  expect(filter.total_sessions).toBe(0);
});

test("library pages count before limits and share date/model/host filters with search and bookmarks", async () => {
  installDemoBackend();
  const filter = {...queryDefaults, limit:1};
  const all = (await backend.listSessions({...filter,limit:null})).filter(session=>!session.parent_key);
  expect(all.length).toBeGreaterThan(500);
  expect(await backend.listSessions(filter)).toHaveLength(1);
  const keys: string[] = [];
  for (let offset=0;offset<all.length;offset+=17) {
    const page = await backend.sessionPage(filter,offset,17);
    expect(page.total).toBe(all.length);
    expect(page.offset).toBe(offset);
    keys.push(...page.items.map(session=>session.key));
  }
  expect(keys).toEqual(all.map(session=>session.key));
  expect(new Set(keys).size).toBe(all.length);
  expect((await backend.sessionPage(filter,all.length,1000)).items).toEqual([]);
  const chosen = all.find(session=>session.model === "sample")!;
  const date = {...filter,model:chosen.model,updated_from_ms:chosen.updated_at,updated_before_ms:chosen.updated_at+1};
  expect((await backend.sessionPage(date,0,100)).items.map(session=>session.key)).toEqual([chosen.key]);
  expect((await backend.searchGrouped("pagination",date,"recent",0,100)).total_sessions).toBe(1);
  expect((await backend.searchGrouped("pagination",filter,"recent",0,100)).total_sessions).toBe(54);
  expect((await backend.sessionPage({...filter,host:"missing"},0,100)).total).toBe(0);
  expect((await backend.sessionPage({...filter,local_only:true},0,100)).items.every(session=>!session.host)).toBe(true);
  expect((await backend.listBookmarks("",{...filter,local_only:true})).some(view=>view.status === "unavailable")).toBe(false);
  expect((await backend.listBookmarks("",filter)).some(view=>view.status === "unavailable")).toBe(true);
  for (const invalid of [{...filter,host:"buildbox",local_only:true},{...filter,updated_from_ms:2,updated_before_ms:1}]) {
    await expect(backend.sessionPage(invalid,0,100)).rejects.toThrow();
    await expect(backend.searchGrouped("pagination",invalid,"recent",0,100)).rejects.toThrow();
    await expect(backend.listBookmarks("",invalid)).rejects.toThrow();
  }
});


test("large preview search and host choices stay complete beyond one hundred matches", async () => {
  installDemoBackend();
  const options=await backend.libraryOptions();
  expect(options.hosts).toEqual(["buildbox","local"]);
  const keys:string[]=[];
  for(let offset=0;offset<540;offset+=50) {
    const page=await backend.searchGrouped("browsing sample",queryDefaults,"recent",offset,50);
    expect(page.total_sessions).toBe(540);
    keys.push(...page.groups.map(group=>group.session.key));
  }
  expect(new Set(keys).size).toBe(540);
  expect((await backend.sessionPage({...queryDefaults,host:"local"},0,100)).items.every(session=>session.host === "local")).toBe(true);
  expect((await backend.sessionPage({...queryDefaults,local_only:true},0,100)).items.every(session=>session.host === null)).toBe(true);
  expect((await backend.sessionPage({...queryDefaults,include_archived:true},0,100)).total).toBeGreaterThan(600);
});


test("project preview totals and evidence come from scoped sample originals", async()=>{
  installDemoBackend();
  const path="/Users/you/dev/ronda";
  const local=await backend.projectOverview(path,null,true);
  const sessions=await backend.listSessions({...queryDefaults,project_path:path,local_only:true,limit:null});
  expect(local.total_sessions).toBe(sessions.filter(session=>!session.parent_key).length);
  expect(local.sessions).toHaveLength(10);
  expect(local.intelligence!.totals.sessions).toBe(sessions.filter(session=>!session.parent_key && session.updated_at>=local.since).length);
  expect(local.errors).toHaveLength(1);
  expect(local.errors[0].sessions).toBe(14);
  for(const evidence of local.errors[0].evidence){
    expect((await backend.getSession(evidence.session_key))!.host).toBeNull();
    expect((await backend.getTranscript(evidence.session_key)).find(message=>message.seq===evidence.seq)!.tool_calls[0].is_error).toBe(true);
  }
  const remote=await backend.projectOverview(path,"buildbox",false);
  expect(remote.errors[0].sessions).toBe(14);
  expect(remote.total_bookmarks).toBe(0);
  expect(remote.intelligence!.totals.sessions).toBe(14);
  expect(remote.sessions.every(session=>session.host==="buildbox")).toBe(true);
  const empty=await backend.projectOverview("/missing/ronda",null,false);
  expect(empty.total_sessions).toBe(0);expect(empty.total_errors).toBe(0);
  const unavailable=await backend.projectOverview("/Users/you/dev/payments-api",null,false);
  expect(unavailable.bookmarks.some(view=>view.status==="unavailable")).toBe(true);
  await expect(backend.projectOverview(path,"buildbox",true)).rejects.toThrow("either");
});


test("synthetic error history pages distinct originals and scopes coverage before limits",async()=>{
  installDemoBackend();
  const text="Error: SYNTHETIC_PROJECT_CHECK failed",path="/Users/you/dev/ronda";
  const first=await backend.errorHistory(text,null,null,false,0),second=await backend.errorHistory(text,null,null,false,20);
  expect([first.total,first.hits.length,second.hits.length]).toEqual([28,20,8]);
  expect(new Set([...first.hits,...second.hits].map(hit=>hit.session.key)).size).toBe(28);
  for(const hit of [...first.hits,...second.hits])expect((await backend.getTranscript(hit.session.key)).find(message=>message.seq===hit.seq)!.tool_calls[0].output).toBe(text);
  const remote=await backend.errorHistory(text,path,"buildbox",false,0);
  expect(remote.total).toBe(14);expect(remote.hits.every(hit=>hit.session.host==="buildbox")).toBe(true);
  const local=await backend.errorHistory(text,path,null,true,0);expect(local.total).toBe(14);
  const empty=await backend.errorHistory("Error: unknown sample",path,null,false,0);expect(empty.total).toBe(0);expect(empty.with_tools).toBeLessThan(empty.indexed_sessions);
  await expect(backend.errorHistory(" ",null,null,false,0)).rejects.toThrow("20,000");
});
