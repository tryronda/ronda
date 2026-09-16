import { mount } from "../Chrome";
import { BrandApp } from "./BrandApp";
import "../site.css";

// Production builds ship prerendered markup (scripts/prerender-site.ts); the dev server does not.
mount(<BrandApp />);
