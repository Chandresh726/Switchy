"use client";

import Image from "next/image";
import Link from "next/link";

import { motion } from "framer-motion";
import { Sun, Moon } from "lucide-react";

import { GithubIcon } from "@/components/icons";
import { navVariants } from "@/lib/animations";
import { NAV_LINKS, SITE_CONFIG } from "@/lib/constants";
import { useTheme } from "@/lib/use-theme";

function scrollToTop(e: React.MouseEvent) {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center justify-center w-10 h-10 border-2 border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-[var(--text-primary)]" />
      ) : (
        <Moon className="w-4 h-4 text-[var(--text-primary)]" />
      )}
    </button>
  );
}

export function Navbar() {
  return (
    <motion.header
      variants={navVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50 px-4 py-2 md:px-6 md:py-3"
    >
      <nav className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between border-2 border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2 md:px-5">
          <Link href="/" onClick={scrollToTop} className="flex items-center gap-3">
            <Image
              src="/switchy-logo.png"
              alt="Switchy Logo"
              width={36}
              height={36}
              className="object-contain"
            />
            <span className="font-display font-bold text-base md:text-xl text-[var(--text-primary)] tracking-tight">{SITE_CONFIG.name}</span>
          </Link>
          
          <ul className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="font-medium text-[var(--text-primary)] hover:text-[#10b981] transition-colors">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          
          <div className="flex items-center gap-2 md:gap-3">
            <ThemeToggle />
            <a
              href={SITE_CONFIG.github}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-5 py-2 border-2 border-[var(--border-color)] bg-[#10b981] hover:bg-[#34d399] hover:text-black transition-colors font-bold"
            >
              <GithubIcon className="w-4 h-4" />
              GitHub
            </a>
          </div>
        </div>
      </nav>
    </motion.header>
  );
}
