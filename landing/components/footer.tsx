"use client";

import { Github } from "lucide-react";
import Image from "next/image";

import { SITE_CONFIG, SOCIAL_LINKS } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="px-6 py-8 border-t-2 border-[var(--border-color)]">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <Image
              src="/switchy-logo.png"
              alt="Switchy Logo"
              width={40}
              height={40}
              className="object-contain"
            />
            <div className="text-left">
              <span className="font-display font-bold text-xl text-[var(--text-primary)] tracking-tight">{SITE_CONFIG.name}</span>
              <p className="text-xs text-[var(--text-secondary)]">{SITE_CONFIG.tagline}</p>
            </div>
          </button>
          
          <div className="hidden sm:flex items-center gap-4">
            <a href={SOCIAL_LINKS.github} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[var(--text-primary)] hover:text-[#10b981] transition-colors font-bold text-sm">
              <Github className="w-4 h-4" />
              GitHub
            </a>
          </div>
        </div>
        
        <div className="mt-6 pt-4 border-t border-[var(--border-color)] text-center">
          <p className="text-[var(--text-secondary)] text-xs font-medium">Built with passion for job seekers everywhere.</p>
        </div>
      </div>
    </footer>
  );
}
