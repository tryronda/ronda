import { expect, test } from "vitest";
import type { SessionMeta, TranscriptMessage, WorkbenchBackend } from "./api";
import { contextEligible, formatContext, loadContext, validateContext } from "./context-bundle";

const session = (key: string) => ({key, title:`Session ${key}`, agent:"codex", project_path:`/projects/${key}`, host:null} as SessionMeta);
const message = (seq: number): TranscriptMessage => ({seq, role:"assistant", kind:"text", text:`你好 😀 message ${seq}\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``, timestamp:0, model:null,
  thinking:"private thinking", images:[{media_type:"image/png",data_base64:"PRIVATE_IMAGE_PAYLOAD"}],
  tool_calls:[{id:"tool",name:"shell",input:"printf '```'",output:"tool output",is_error:false}]});

test("context preserves selected source text, sequence order and local references, excludes internals, and never truncates", () => {
  const sources = [{session:session("one"),messages:[message(7),message(2)]},{session:session("two"),messages:[message(3)]}];
  const draft = formatContext(sources);
  expect(draft.indexOf("message #2")).toBeLessThan(draft.indexOf("message #7"));
  expect(draft.indexOf("Session one")).toBeLessThan(draft.indexOf("Session two"));
  expect(draft).toContain(message(7).text);
  expect(draft).toContain("Timestamp: 1970-01-01T00:00:00.000Z");
  expect(draft).toContain("Reference: ronda://session/one#7");
  expect(draft).not.toMatch(/private thinking|PRIVATE_IMAGE_PAYLOAD|tool output|printf/);
  const included = formatContext(sources,{tools:true,thinking:true});
  expect(included).toContain("````\nprintf '```'\n````");
  expect(included).toContain("private thinking");
  expect(included).not.toContain("PRIVATE_IMAGE_PAYLOAD");
  for (const internal of [{...message(0),role:"system" as const},{...message(0),kind:"meta" as const},{...message(0),kind:"compact_summary" as const}]) {
    expect(contextEligible(internal)).toBe(false);
    expect(()=>formatContext([{session:session("one"),messages:[internal]}])).toThrow(/internal context/);
  }
  expect(()=>validateContext("😀".repeat(100_000))).not.toThrow();
  expect(()=>validateContext("😀".repeat(100_001))).toThrow(/nothing was truncated/);
  expect(()=>formatContext([{session:session("one"),messages:[{...message(0),text:"a".repeat(100_000)}]}])).toThrow(/Reduce/);
});

test("selected bookmarks resolve only real messages, deduplicate references and fail when originals disappear", async () => {
  const reads: string[]=[];
  const api = {
    getSession:async (key:string)=>{reads.push(`session:${key}`);return key === "missing" ? null : session(key);},
    getTranscript:async (key:string)=>{reads.push(`transcript:${key}`);return [message(2),message(7)];},
  } as WorkbenchBackend;
  const loaded=await loadContext(api,[{key:"one",seq:7},{key:"two",seq:2},{key:"one",seq:7}]);
  expect(loaded.map(source=>[source.session.key,source.messages.map(item=>item.seq)])).toEqual([["one",[7]],["two",[2]]]);
  expect(reads).toHaveLength(4);
  await expect(loadContext(api,[{key:"missing",seq:2}])).rejects.toThrow(/session is unavailable/);
  await expect(loadContext(api,[{key:"one",seq:9}])).rejects.toThrow(/message.*unavailable/);
  await expect(loadContext(api,[])).rejects.toThrow(/Select/);
});
