// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createRoot, hydrateRoot } from "react-dom/client";
import { mount } from "./Chrome";
vi.mock("react-dom/client", () => ({createRoot:vi.fn(()=>({render:vi.fn()})),hydrateRoot:vi.fn()}));

test("mount renders a comment-only dev root and hydrates real prerendered elements", () => {
  document.body.innerHTML='<div id="root"><!--app-html--></div>';
  mount(<div>App</div>);
  expect(createRoot).toHaveBeenCalledTimes(1);expect(hydrateRoot).not.toHaveBeenCalled();
  document.getElementById("root")!.innerHTML="<div>App</div>";
  mount(<div>App</div>);
  expect(hydrateRoot).toHaveBeenCalledTimes(1);
  document.body.innerHTML="";
});
