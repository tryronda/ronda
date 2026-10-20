// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { backend, queryDefaults, type BookmarkBackup, type SessionQuery, type BookmarkImport } from "@/workbench/api";
import { version as appVersion } from "../../package.json";
import { appendDemoMessage, changeFirstDemoAssistantReply, installDemoBackend, insertEarlierDemoMessage, uninstallDemoBackend } from "./demo";
import { captureReadingPosition, resolveReadingPosition } from "@/workbench/reading-position";

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

test("source health preview shows fixed local states and refreshes deterministically without visitor data", async () => {
  installDemoBackend();
  const locations = await invoke<{health_id:string;enabled:boolean}[]>("list_locations");
  const initial = await invoke<{completed_at_ms:number;roots:{id:string;status:string;source_records:number;issues:number}[]}>("get_local_source_refresh_health");
  expect(locations.map(location=>location.health_id)).toContain("a".repeat(64));
  expect(initial.roots.map(root=>root.status)).toEqual(["checked","unavailable","partial","checked"]);
  expect(initial.roots.find(root=>root.id==="a".repeat(64))?.source_records).toBe(18);
  expect(initial.roots.find(root=>root.id==="d".repeat(64))?.source_records).toBe(0);
  const firstReport = await invoke("scan");
  const firstRefresh = await invoke<typeof initial>("get_local_source_refresh_health");
  expect(firstReport).toMatchObject({discovered:25});
  expect(firstRefresh.completed_at_ms).toBeGreaterThanOrEqual(initial.completed_at_ms);
  expect(firstRefresh.roots.find(root=>root.id==="c".repeat(64))?.status).toBe("checked");
  expect(firstRefresh.roots.find(root=>root.id==="c".repeat(64))?.issues).toBe(0);
  await invoke("scan");
  const secondRefresh = await invoke<typeof initial>("get_local_source_refresh_health");
  expect(secondRefresh.roots.find(root=>root.id==="c".repeat(64))?.status).toBe("partial");
  expect(secondRefresh.roots.find(root=>root.id==="c".repeat(64))?.issues).toBe(1);
  uninstallDemoBackend();
  installDemoBackend();
  expect((await invoke<typeof initial>("get_local_source_refresh_health")).roots.find(root=>root.id==="c".repeat(64))?.status).toBe("partial");
});

test("preview saved-search seed replays against the sample index and resets on reload", async () => {
  installDemoBackend();
  const raw = await backend.getPref("saved_searches_v1");
  const saved = JSON.parse(raw!) as { version: number; items: { name: string; query: string; filters: Record<string, unknown>; sort: string }[] };
  expect(saved).toMatchObject({ version: 1, items: [{ name: "Preference storage", query: "Preferences now live", sort: "relevance" }] });
  const results = await backend.searchGrouped(saved.items[0].query, { ...queryDefaults, project_path: saved.items[0].filters.project as string },
    saved.items[0].sort as "relevance" | "recent", 0, 50);
  expect(results.total_sessions).toBeGreaterThan(0);
  expect(results.groups.some(group => group.session.project_path === saved.items[0].filters.project)).toBe(true);
  const next = { version: 1 as const, items: [{ ...saved.items[0], name: "Renamed preview search", query: "pagination" }] };
  await backend.setPref("saved_searches_v1", JSON.stringify(next));
  expect(JSON.parse((await backend.getPref("saved_searches_v1"))!).items[0].name).toBe("Renamed preview search");
  uninstallDemoBackend();
  installDemoBackend();
  expect(await backend.getPref("saved_searches_v1")).toBe(raw);
});

test("sample reading snapshots use SHA-256 and preferences reset when the preview reloads", async () => {
  installDemoBackend();
  const savedSearches = await backend.getPref("saved_searches_v1");
  expect(JSON.parse(savedSearches!).items[0]).toMatchObject({ name: "Preference storage", query: "Preferences now live" });
  const snapshot = await backend.getTranscriptSnapshot("claude-code:demo-0");
  expect(snapshot.messages.length).toBeGreaterThan(0);
  expect(snapshot.fingerprints).toHaveLength(snapshot.messages.length);
  expect(snapshot.session_key_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(snapshot.fingerprints.every(value => /^[0-9a-f]{64}$/.test(value))).toBe(true);
  await backend.setPref("reading_positions_v1", "synthetic only");
  expect(await backend.getPref("reading_positions_v1")).toBe("synthetic only");
  await backend.setPref("saved_searches_v1", JSON.stringify({ version: 1, items: [] }));
  expect(JSON.parse((await backend.getPref("saved_searches_v1"))!).items).toEqual([]);
  uninstallDemoBackend();
  installDemoBackend();
  expect(await backend.getPref("reading_positions_v1")).toBeNull();
  expect(await backend.getPref("saved_searches_v1")).toBe(savedSearches);
});

test("synthetic earlier insertion preserves exact saved content and an edited reply becomes stale", async () => {
  installDemoBackend();
  const key = "claude-code:demo-0";
  const original = await backend.getTranscriptSnapshot(key);
  const saved = captureReadingPosition(original, 1, Date.now(), 1)!;
  const firstReplyFingerprint = original.fingerprints[1];

  insertEarlierDemoMessage();
  const inserted = await backend.getTranscriptSnapshot(key);
  expect(inserted.messages[2].seq).toBe(original.messages[1].seq + 1);
  expect(inserted.fingerprints[2]).toBe(firstReplyFingerprint);
  expect(resolveReadingPosition(inserted, saved)).toEqual({ status: "resolved", seq: inserted.messages[2].seq });

  changeFirstDemoAssistantReply();
  const edited = await backend.getTranscriptSnapshot(key);
  expect(edited.fingerprints[2]).not.toBe(firstReplyFingerprint);
  expect(resolveReadingPosition(edited, saved)).toEqual({ status: "stale" });
});

test("sample project folders require the desktop app", async () => {
  installDemoBackend();
  await expect(invoke("open_project_folder", {key:"claude-code:demo-0"}))
    .rejects.toThrow("Desktop required: sample sessions cannot open a project folder.");
});

test("sample source files require the desktop app", async () => {
  installDemoBackend();
  await expect(invoke("reveal_source_file", {key:"claude-code:demo-0"}))
    .rejects.toThrow("Desktop required: sample sessions cannot reveal a source file.");
});

test("preview scan examples are fixed, local-only, and alternate clean then partial", async () => {
  installDemoBackend();
  const first = await invoke<{discovered:number;indexed:number;unchanged:number;errors:string[]}>("scan");
  const second = await invoke<{discovered:number;indexed:number;unchanged:number;errors:string[]}>("scan");
  expect(first).toEqual({discovered:25,indexed:1,unchanged:24,errors:[]});
  expect(second).toEqual({discovered:25,indexed:1,unchanged:24,errors:["Synthetic sample scan error; details are hidden."]});
  expect(first.discovered).toBe(first.indexed + first.unchanged);
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

test("label preview supports create, rename, assign, filter, caps, and delete, then resets on reload", async () => {
  installDemoBackend();
  const initial = await backend.listSessionLabels();
  expect(initial.map(label => label.name)).toEqual(["Needs follow-up", "Reference", "Handoff"]);
  const [followUp, reference, handoff] = initial;
  const withLabel = async (id: string) => (await backend.sessionPage({ ...queryDefaults, label_id: id }, 0, 100)).items.map(session => session.key).sort();
  expect(await withLabel(followUp.id)).toEqual(["claude-code:demo-0", "codex:demo-1"]);
  expect(await withLabel(handoff.id)).toEqual([]);
  expect(await withLabel("f".repeat(32))).toEqual([]);
  const grouped = await backend.searchGrouped("idempotency", { ...queryDefaults, label_id: followUp.id }, "recent", 0, 10);
  expect(grouped.groups.map(group => group.session.key)).toEqual(["codex:demo-1"]);

  const created = await backend.createSessionLabel("  Ideas ");
  expect(created.name).toBe("Ideas");
  await expect(backend.createSessionLabel("ideas")).rejects.toThrow("already exists");
  await expect(backend.createSessionLabel("   ")).rejects.toThrow("Enter a label name");
  await expect(backend.createSessionLabel("x".repeat(41))).rejects.toThrow("40 characters");
  expect((await backend.renameSessionLabel(created.id, "Ideas backlog")).name).toBe("Ideas backlog");
  await expect(backend.renameSessionLabel(created.id, "REFERENCE")).rejects.toThrow("already exists");
  for (let index = (await backend.listSessionLabels()).length; index < 12; index++) await backend.createSessionLabel(`Extra ${index}`);
  await expect(backend.createSessionLabel("Over the cap")).rejects.toThrow("at most 12");

  const key = "codex:demo-1";
  await backend.setSessionLabel(key, reference.id, true);
  await backend.setSessionLabel(key, handoff.id, true);
  await backend.setSessionLabel(key, created.id, true);
  await expect(backend.setSessionLabel(key, (await backend.listSessionLabels()).at(-1)!.id, true)).rejects.toThrow("at most 4");
  expect((await backend.getSession(key))?.labels).toHaveLength(4);
  await backend.setSessionLabel(key, handoff.id, false);
  expect(await withLabel(handoff.id)).toEqual([]);

  await backend.deleteSessionLabel(followUp.id);
  expect((await backend.getSession(key))?.labels).not.toContain(followUp.id);
  expect(await withLabel(followUp.id)).toEqual([]);
  expect((await backend.listSessionLabels()).some(label => label.id === followUp.id)).toBe(false);

  uninstallDemoBackend();
  installDemoBackend();
  expect((await backend.listSessionLabels()).map(label => label.name)).toEqual(["Needs follow-up", "Reference", "Handoff"]);
  expect((await backend.getSession(key))?.labels).toEqual([followUp.id]);
});

test("label names never appear in preview bookmark backups or diagnostics", async () => {
  installDemoBackend();
  const canary = "CANARY-LABEL-NAME-7731";
  const label = await backend.createSessionLabel(canary);
  await backend.setSessionLabel("claude-code:demo-0", label.id, true);
  expect(await invoke<string>("get_bookmark_backup")).not.toContain(canary);
  expect(JSON.stringify(await invoke("get_diagnostics_report"))).not.toContain(canary);
});

test("preview bookmark rows follow the labels of their linked sessions", async () => {
  installDemoBackend();
  const [followUp] = await backend.listSessionLabels();
  const all = await backend.listBookmarks("", queryDefaults);
  const filtered = await backend.listBookmarks("", { ...queryDefaults, label_id: followUp.id });
  const labelled = new Set((await backend.listSessions({ ...queryDefaults, label_id: followUp.id, limit: null, include_archived: true })).map(session => session.key));
  expect(filtered.map(view => view.bookmark.session_key).sort()).toEqual(all.filter(view => labelled.has(view.bookmark.session_key)).map(view => view.bookmark.session_key).sort());
  expect(filtered.length).toBeLessThan(all.length);
  expect(await backend.listBookmarks("", { ...queryDefaults, label_id: "f".repeat(32) })).toEqual([]);
});

test("preview session Markdown honors the export options, fences safely, and refuses oversized copies", async () => {
  installDemoBackend();
  const key = "claude-code:demo-0";
  const plain = await backend.sessionMarkdown(key, { includeTools: false, includeThinking: false });
  expect(plain).toMatch(/^# .+\n\nAgent: claude-code\nProject: .+\n\n## User · 0\n\n/);
  expect(plain).toBe(await backend.sessionMarkdown(key));
  expect(plain).not.toContain("Reference: ronda://");
  const messages = await backend.getTranscript(key);
  messages[1].thinking = "plan ```` inside";
  messages[1].tool_calls = [{ id: "t", name: "Bash", input: "echo ``` hi", output: "secret-output", is_error: true }];
  const detailed = await backend.sessionMarkdown(key, { includeTools: true, includeThinking: true });
  expect(detailed).toContain("Reference: ronda://session/" + key + "#1");
  expect(detailed).toContain("- Tool: Bash (recorded error)\n\nInput:\n\n````\necho ``` hi\n````");
  expect(detailed).toContain("Thinking:\n\n`````\nplan ```` inside\n`````");
  expect(await backend.sessionMarkdown(key, { includeTools: false, includeThinking: true })).not.toContain("secret-output");
  messages[0].text = "x".repeat(100_001);
  await expect(backend.sessionMarkdown(key)).rejects.toThrow("Nothing was copied or truncated");
  await expect(backend.sessionMarkdown("missing")).rejects.toThrow("unknown session");
});

test("bulk triage preview changes only the requested flag, skips unknown keys, and restores exactly", async () => {
  installDemoBackend();
  const { items } = await backend.sessionPage(queryDefaults, 0, 100);
  const [a, b, c] = items;
  const before = [a, b, c].map(item => [item.key, !!item.starred, !!item.pinned] as [string, boolean, boolean]);
  const applied = await backend.setSessionFlagsBulk([
    [a.key, true, !!a.pinned], [b.key, !!b.starred, true], ["demo:missing", true, true], [c.key, !c.starred, !c.pinned],
  ]);
  expect(applied).toBe(3);
  const after = await Promise.all([a, b, c].map(item => backend.getSession(item.key)));
  expect([after[0]!.starred, after[0]!.pinned]).toEqual([true, !!a.pinned]);
  expect([after[1]!.starred, after[1]!.pinned]).toEqual([!!b.starred, true]);
  expect([after[2]!.starred, after[2]!.pinned]).toEqual([!c.starred, !c.pinned]);
  expect(await backend.setSessionFlagsBulk(before)).toBe(3);
  const restored = await Promise.all([a, b, c].map(item => backend.getSession(item.key)));
  expect(restored.map(item => [item!.key, !!item!.starred, !!item!.pinned])).toEqual(before);
  uninstallDemoBackend();
  installDemoBackend();
  expect((await backend.getSession(a.key))!.starred).toBe(!!a.starred);
});

test("library sort options order pages with pins first and deterministic ties", async () => {
  installDemoBackend();
  const base = {...queryDefaults, limit:null};
  const rows = (await backend.listSessions(base)).filter(session=>!session.parent_key);
  const pinned = rows.filter(session=>session.pinned).length;
  expect(pinned).toBeGreaterThan(0);
  const keys = async (sort?: SessionQuery["sort"]) => {
    const out: string[] = [];
    for (let offset=0;offset<rows.length;offset+=37) out.push(...(await backend.sessionPage({...base,sort},offset,37)).items.map(session=>session.key));
    return out;
  };
  expect(await keys()).toEqual(rows.map(session=>session.key));
  expect(await keys("updated_desc")).toEqual(await keys());
  for (const sort of ["updated_asc","created_desc","tokens_desc"] as const) {
    const got = await keys(sort);
    expect(new Set(got).size).toBe(rows.length);
    const byKey = new Map(rows.map(session=>[session.key,session]));
    expect(got.slice(0,pinned).every(key=>byKey.get(key)!.pinned)).toBe(true);
    expect(got.slice(pinned).every(key=>!byKey.get(key)!.pinned)).toBe(true);
    const value = (key: string) => { const session = byKey.get(key)!; return sort==="updated_asc" ? -session.updated_at : sort==="created_desc" ? session.created_at : session.tokens ?? -1; };
    const rest = got.slice(pinned);
    expect(rest.every((key,index)=>index===0 || value(rest[index-1])>value(key) || (value(rest[index-1])===value(key) && rest[index-1]<key))).toBe(true);
  }
});

test("preview remote hosts reject names the desktop core would refuse", async () => {
  installDemoBackend();
  for (const bad of ["", "-oProxyCommand=x", "a b", "host;rm", "a/b"]) await expect(invoke("set_remote_host", { host: bad, enabled: true })).rejects.toThrow("invalid SSH host");
  await invoke("set_remote_host", { host: "me@box.example.com", enabled: true });
  expect((await invoke<{ host: string }[]>("list_remote_hosts")).map(item => item.host)).toContain("me@box.example.com");
  uninstallDemoBackend();
});

test("preview Settings locations reflect added, disabled, and removed locations and reset on reload", async () => {
  installDemoBackend();
  type Row = { agent: string; path: string; enabled: boolean; custom: boolean; health_id: string };
  const list = () => invoke<Row[]>("list_locations");
  const before = await list();
  expect(before.every(row => !row.custom)).toBe(true);
  await invoke("set_pref", { key: "custom_roots", value: JSON.stringify({ codex: ["/work/codex"] }) });
  const added = (await list()).find(row => row.path === "/work/codex")!;
  expect(added).toMatchObject({ agent: "codex", custom: true, enabled: true });
  expect(added.health_id).toHaveLength(64);
  await invoke("set_pref", { key: "disabled_roots", value: JSON.stringify(["/work/codex", "/Users/you/.cursor/chats"]) });
  const disabled = await list();
  expect(disabled.find(row => row.path === "/work/codex")?.enabled).toBe(false);
  expect(disabled.find(row => row.path === "/Users/you/.cursor/chats")?.enabled).toBe(false);
  expect(disabled.find(row => row.path === "/Users/you/.gemini/tmp")?.enabled).toBe(true);
  await invoke("set_pref", { key: "custom_roots", value: "{}" });
  await invoke("set_pref", { key: "disabled_roots", value: "[]" });
  expect(await list()).toHaveLength(before.length);
  uninstallDemoBackend();
  installDemoBackend();
  expect((await list()).find(row => row.path === "/Users/you/.gemini/tmp")?.enabled).toBe(false);
});

test("preview diagnostics report the current app version", async () => {
  installDemoBackend();
  expect((await invoke<{ app_version: string }>("get_diagnostics_report")).app_version).toBe(appVersion);
  uninstallDemoBackend();
});
