import { mount } from "../Chrome";
import { DocsApp } from "./DocsApp";
import "../site.css";

// Production builds ship prerendered markup (scripts/prerender-site.ts); the dev server does not.
mount(<DocsApp />);
