import { mount } from "./Chrome";
import { App } from "./App";
import "./site.css";

// Production builds ship prerendered markup (scripts/prerender-site.ts); the dev server does not.
mount(<App />);
