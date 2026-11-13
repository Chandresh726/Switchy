import { ArrowRight, Terminal } from "lucide-react";

import { GithubIcon } from "@/components/icons";
import { SITE_CONFIG } from "@/lib/constants";

export function Hero() {
  return (
    <section className="relative flex items-center justify-center overflow-hidden px-6 pb-20 pt-[8.375rem] grid-bg md:pb-40 md:pt-[11.375rem]">
      <div className="relative z-10 max-w-6xl mx-auto text-center">
        <div
          className="hero-reveal mb-6 inline-flex items-center border-2 border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2"
        >
          <span className="text-sm font-bold tracking-wide text-[var(--text-primary)]">
            OPEN SOURCE • LOCAL FIRST
          </span>
        </div>
        
        <h1
          className="mb-7 font-display text-5xl font-black leading-none tracking-tighter md:text-6xl lg:text-7xl"
        >
          YOUR{" "}
          <span className="gradient-text">JOB SEARCH</span>
          <br />
          COMMAND CENTER
        </h1>
        
        <p
          className="hero-reveal mx-auto mb-10 max-w-2xl text-lg font-medium text-[var(--text-secondary)] md:text-xl"
        >
          {SITE_CONFIG.description}
        </p>
        
        <div
          className="hero-reveal flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="#installation"
            className="geo-card-solid inline-flex items-center gap-3 px-8 py-4 text-black font-bold text-lg"
          >
            <Terminal className="h-5 w-5" />
            INSTALL SWITCHY
            <ArrowRight className="w-5 h-5" />
          </a>

          <a
            href={SITE_CONFIG.github}
            target="_blank"
            rel="noopener noreferrer"
            className="geo-card inline-flex items-center gap-3 px-8 py-4 text-[var(--text-primary)] font-bold text-lg"
          >
            <GithubIcon className="h-5 w-5" />
            VIEW ON GITHUB
          </a>
        </div>
      </div>
    </section>
  );
}
