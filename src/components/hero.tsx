import { TypeLine } from "@/components/type-line";
import { resumeData } from "@/data/resume";
import Link from "next/link";

export function Hero() {
  const { personal } = resumeData;

  return (
    <section
      aria-label="Introduction"
      className="paper-canvas band-invert border-b border-border"
    >
      <div className="hero-seq mx-auto w-full max-w-[1180px] px-5 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
        <h1
          data-seq="1"
          className="font-serif text-[clamp(2.75rem,6.5vw,5.25rem)] leading-[1.02] tracking-[-0.025em] text-ink-brown"
        >
          {personal.name}
        </h1>

        <p data-seq="2" className="eyebrow mt-6 text-ink-faint">
          <TypeLine text={`${personal.role} at ${personal.company}`} />
        </p>

        <div
          data-seq="3"
          className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4"
        >
          <Link
            href="/#projects"
            className="inline-flex min-h-11 items-center rounded bg-primary px-5 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-[var(--clay-deep-hover)] active:scale-[0.98]"
          >
            View work
          </Link>
          <a
            href="/David_Mallick_CV.pdf"
            download="David_Mallick_CV.pdf"
            className="text-sm text-clay-text underline decoration-1 underline-offset-4 transition-colors hover:text-ink-brown"
          >
            Download CV
          </a>
        </div>
      </div>
    </section>
  );
}
