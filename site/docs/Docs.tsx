import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { PageIntro, SectionNav, SiteFooter, SiteHeader } from "../Chrome";
import { REPO_URL } from "../release";
import { docs } from "./sections";

export function Docs() {
  return <div className="min-h-full bg-background text-foreground">
    <SiteHeader page="docs" />
    <main id="main" className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-16 lg:py-20">
      <PageIntro eyebrow="docs" title="Documentation">
        <SectionNav label="Documentation" sections={docs} />
        <a href={`${REPO_URL}/issues`} className="mt-5 inline-flex items-center gap-1.5 font-mono text-[13px] tracking-[0.025em] text-foreground/60 underline decoration-stone underline-offset-2 hover:text-foreground">
          ask a question<HugeiconsIcon icon={ArrowRight01Icon} size={13} /></a>
      </PageIntro>
      <div className="docs-body min-w-0">
        {docs.map(doc => <article key={doc.id} id={doc.id} className="mb-10 scroll-mt-24 border-b border-border pb-10 last:mb-0 last:border-b-0">
          <h2 className="font-serif text-[32px] leading-[1.1] tracking-[-0.01em]">
            <a href={`#${doc.id}`} className="hover:underline hover:decoration-stone hover:underline-offset-4">{doc.title}</a>
          </h2>
          <div className="mt-4">{doc.body}</div>
        </article>)}
      </div>
    </main>
    <SiteFooter />
  </div>;
}
