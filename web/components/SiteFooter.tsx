import Link from "next/link";
import { AUTHOR, LINKS } from "@/lib/site";

/** Attribution strip for the match dashboards — deep links land here, not on the
    landing page, so every route has to carry the byline and a way back to /how. */
export default function SiteFooter() {
  return (
    <footer className="mt-16 pt-6 border-t border-[var(--line-soft)] flex flex-wrap items-baseline gap-x-5 gap-y-2 text-[12.5px]">
      <span className="text-dim">
        Built by <span className="text-mut">{AUTHOR}</span>
      </span>
      <Link href="/how/" className="text-dim hover:text-ink transition-colors">
        How it works
      </Link>
      <a
        href={LINKS.repo}
        target="_blank"
        rel="noopener noreferrer"
        className="text-dim hover:text-ink transition-colors"
      >
        Source ↗
      </a>
      <a
        href={LINKS.site}
        target="_blank"
        rel="noopener noreferrer"
        className="text-dim hover:text-ink transition-colors"
      >
        jaydenclim.com ↗
      </a>
    </footer>
  );
}
