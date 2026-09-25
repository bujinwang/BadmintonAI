import Link from "next/link";

export default function NotFound() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-24 w-full">
      <div className="kicker mb-3">404 · OUT</div>
      <h1 className="text-[clamp(2rem,5vw,3rem)] font-bold leading-tight tracking-tight">
        The shuttle landed outside the lines.
      </h1>
      <p className="text-mut text-[15px] leading-relaxed mt-4">
        That page doesn&apos;t exist. Every match lives under{" "}
        <span className="mono text-[13px]">/m/&lt;match&gt;/&lt;source&gt;/&lt;view&gt;</span> — the
        index has all of them.
      </p>
      <div className="flex flex-wrap gap-3 mt-8">
        <Link
          href="/"
          className="px-4 py-2 rounded-md text-[13.5px] font-medium transition-opacity hover:opacity-85"
          style={{ background: "var(--ink)", color: "var(--bg)" }}
        >
          Back to the matches
        </Link>
        <Link
          href="/how/"
          className="px-4 py-2 rounded-md text-[13.5px] border border-[var(--line)] text-mut hover:text-ink hover:border-[var(--mut)] transition-colors"
        >
          How it works →
        </Link>
      </div>
    </main>
  );
}
