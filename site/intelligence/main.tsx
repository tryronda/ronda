import { mount } from "../Chrome";
import { IntelligenceApp } from "./IntelligenceApp";
import "../site.css";

// Production builds ship prerendered markup (scripts/prerender-site.ts); the dev server does not.
mount(<IntelligenceApp />);
