import { mount } from "../Chrome";
import { ChangelogApp } from "./ChangelogApp";
import "../site.css";

// Production builds ship prerendered markup (scripts/prerender-site.ts); the dev server does not.
mount(<ChangelogApp />);
