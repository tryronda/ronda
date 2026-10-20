// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { searchRanges } from "./search-text";
import { transcriptMatches } from "./transcript-find";
import { nearestPrompt, TranscriptNavigation } from "./TranscriptNavigation";

test("literal find preserves Unicode offsets, phrases, overlapping occurrences and rendered fields", () => {
  expect(searchRanges("İ banana AA a.b", "ana", true)).toEqual([{start:3,end:6},{start:5,end:8}]);
  expect(searchRanges("İ banana AA a.b", "aa", true)).toEqual([{start:9,end:11}]);
  expect(searchRanges("İstanbul", "i", true)).toEqual([{start:0,end:1}]);
  expect(searchRanges("one two", "one two", true)).toEqual([{start:0,end:7}]);
  expect(searchRanges("a.b axb", "a.b", true)).toEqual([{start:0,end:3}]);
  const container = document.createElement("div");
  container.innerHTML = `<article id="message-42"><div data-transcript-field="text"><p>Ne<strong>edle</strong> needle</p><p>paragraph</p><p>boundary</p><button>needle</button></div><details><pre data-transcript-field="tool-0-output">NEEDLE</pre></details><details><pre data-transcript-field="thinking">needle</pre></details></article>`;
  const found = transcriptMatches(container, "needle", false);
  expect(found.map(match => [match.id, match.seq, match.range.toString()])).toEqual([
    ["42:text:0",42,"Needle"],["42:text:1",42,"needle"],["42:tool-0-output:0",42,"NEEDLE"],
  ]);
  expect(transcriptMatches(container,"needle",true)).toHaveLength(4);
  expect(transcriptMatches(container,"paragraphboundary",false)).toHaveLength(0);
  expect(transcriptMatches(container,"missing",false)).toHaveLength(0);
});

test("scopes shortcuts, wraps matches, opens tools, preserves refresh, and closes for external jumps", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
  const host=document.createElement("div");document.body.append(host);
  const scope=createRef<HTMLDivElement>();const container=createRef<HTMLDivElement>();
  const beforeScroll=vi.fn();
  const root=createRoot(host);let active=true, jumpToken=0;
  const render=async()=>{await act(async()=>root.render(<div ref={scope} tabIndex={0}>
    <TranscriptNavigation container={container} scope={scope} active={active} embedded promptsOnly={false} setPromptsOnly={()=>{}} reducedMotion jumpToken={jumpToken} onBeforeProgrammaticScroll={beforeScroll}/>
    <div ref={container}><article id="message-2"><p data-transcript-field="text">Needle needle</p><details><pre data-transcript-field="tool-0-output">needle</pre></details></article></div>
    <textarea/><div className="xterm" tabIndex={0}/></div>));};
  const key=async(target:Element,value:string,options:KeyboardEventInit={})=>{const event=new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true,...options});await act(async()=>{target.dispatchEvent(event);});return event;};
  const input0=()=>host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const type=async(value:string)=>{await act(async()=>{const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});};
  try {
    await render();
    const buttons = Array.from(host.querySelectorAll("button"));
    await act(async()=>buttons.find(button=>button.textContent==="First message")!.click());
    expect(scroll.mock.calls.at(-1)?.[0]).toEqual({block:"start",behavior:"instant"});
    expect(beforeScroll).toHaveBeenCalledTimes(1);
    await act(async()=>buttons.find(button=>button.textContent==="Last message")!.click());
    expect(scroll.mock.calls.at(-1)?.[0]).toEqual({block:"end",behavior:"instant"});
    expect(beforeScroll).toHaveBeenCalledTimes(2);
    expect((await key(document.body,"f",{ctrlKey:true})).defaultPrevented).toBe(false);
    expect((await key(host.querySelector("textarea")!,"f",{metaKey:true})).defaultPrevented).toBe(false);
    expect((await key(host.querySelector(".xterm")!,"f",{metaKey:true})).defaultPrevented).toBe(false);
    expect((await key(scope.current!,"f",{metaKey:true})).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
    await type("needle");
    await key(scope.current!,"f",{metaKey:true});
    expect([input0().selectionStart,input0().selectionEnd]).toEqual([0,6]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 3");
    const input=host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await key(input,"Enter",{shiftKey:true});expect(host.querySelector('[role="status"]')?.textContent).toBe("3 of 3");
    expect(beforeScroll.mock.calls.length).toBeGreaterThan(2);
    expect(host.querySelector("details")?.open).toBe(true);
    expect(scroll.mock.calls.at(-1)?.[0]).toMatchObject({behavior:"instant"});
    await act(async()=>{container.current!.querySelector("p")!.append(" needle");await new Promise(resolve=>setTimeout(resolve,0));});
    expect(host.querySelector('[role="status"]')?.textContent).toBe("4 of 4");
    await key(input,"Enter");expect(host.querySelector('[role="status"]')?.textContent).toBe("1 of 4");
    await type("absent");expect(host.querySelector('[role="status"]')?.textContent).toBe("No matches. Try Include thinking");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Next match"]')?.disabled).toBe(true);
    await key(input,"Escape");expect(host.querySelector('input[type="search"]')).toBeNull();
    await key(scope.current!,"f",{ctrlKey:true});jumpToken++;await render();
    expect(host.querySelector('input[type="search"]')).toBeNull();
    active=false;await render();expect((await key(scope.current!,"f",{ctrlKey:true})).defaultPrevented).toBe(false);
    expect(host.querySelector('[aria-label="Transcript navigation"]')?.classList.contains("hidden")).toBe(true);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("expand and collapse all toggle every details in the transcript", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement("div");document.body.append(host);
  const scope=createRef<HTMLDivElement>();const container=createRef<HTMLDivElement>();
  const root=createRoot(host);
  try {
    await act(async()=>root.render(<div ref={scope}>
      <TranscriptNavigation container={container} scope={scope} active embedded={false} promptsOnly={false} setPromptsOnly={()=>{}} reducedMotion jumpToken={0}/>
      <div ref={container}>{[1,2].map(n=><article key={n} id={`message-${n}`}><details><summary>t</summary>x</details></article>)}</div></div>));
    const click=async(label:string)=>act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent===label)!.click());
    const details=()=>Array.from(host.querySelectorAll("details"));
    await click("Expand all");expect(details().every(d=>d.open)).toBe(true);
    await click("Collapse all");expect(details().some(d=>d.open)).toBe(false);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("prompt jump uses buttons and bracket keys, ignoring editable fields", async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement("div");document.body.append(host);
  const scope=createRef<HTMLDivElement>();const container=createRef<HTMLDivElement>();
  const beforeScroll=vi.fn();const scrolled:string[]=[];
  Element.prototype.scrollIntoView=function(this:Element){scrolled.push(this.id);};
  const tops:Record<string,number>={"message-1":-300,"message-3":-10,"message-5":200,"message-7":600};
  const root=createRoot(host);
  try {
    await act(async()=>root.render(<div ref={scope} tabIndex={0}>
      <TranscriptNavigation container={container} scope={scope} active embedded={false} promptsOnly={false} setPromptsOnly={()=>{}} reducedMotion jumpToken={0} onBeforeProgrammaticScroll={beforeScroll}/>
      <div ref={container} tabIndex={0}>
        {[1,3,5,7].map(n=><article key={n} id={`message-${n}`} data-prompt="true">x</article>)}
        <article id="message-4">y</article>
        <textarea/>
      </div></div>));
    for(const [id,top] of Object.entries(tops))host.querySelector(`#${id}`)!.getBoundingClientRect=()=>({top} as DOMRect);
    container.current!.getBoundingClientRect=()=>({top:0} as DOMRect);
    const click=async(label:string)=>act(async()=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent===label)!.click());
    const key=async(target:Element,value:string)=>{const e=new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true});await act(async()=>{target.dispatchEvent(e);});return e;};
    await click("Next prompt");expect(scrolled.at(-1)).toBe("message-5");
    await click("Previous prompt");expect(scrolled.at(-1)).toBe("message-3");
    expect((await key(container.current!,"]")).defaultPrevented).toBe(true);expect(scrolled.at(-1)).toBe("message-5");
    await key(container.current!,"[");expect(scrolled.at(-1)).toBe("message-3");
    const before=scrolled.length;
    await key(host.querySelector("textarea")!,"]");expect(scrolled.length).toBe(before);
    await key(document.body,"]");expect(scrolled.length).toBe(before);
    expect(beforeScroll).toHaveBeenCalledTimes(4);
  } finally {await act(async()=>root.unmount());host.remove();}
});

test("nearestPrompt picks the closest prompt above or below the viewport top", () => {
  expect(nearestPrompt([-300,-10,200,600],0,1)).toBe(2);
  expect(nearestPrompt([-300,-10,200,600],0,-1)).toBe(1);
  expect(nearestPrompt([100],0,-1)).toBe(-1);
  expect(nearestPrompt([-100],0,1)).toBe(-1);
  expect(nearestPrompt([0,50],0,1)).toBe(1);
});
