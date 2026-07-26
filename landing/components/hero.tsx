"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { GithubIcon } from "@/components/icons";
import { SITE_CONFIG } from "@/lib/constants";
import { fadeInScale, fadeInY } from "@/lib/animations";

export function Hero() {
  return (
    <section className="relative flex items-center justify-center overflow-hidden px-6 pb-20 pt-[8.375rem] grid-bg md:pb-40 md:pt-[11.375rem]">
      <div className="relative z-10 max-w-6xl mx-auto text-center">
        <motion.div
          variants={fadeInScale}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.5 }}
          className="mb-6 inline-flex items-center border-2 border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2"
        >
          <span className="text-sm font-bold tracking-wide text-[var(--text-primary)]">
            OPEN SOURCE • LOCAL FIRST
          </span>
        </motion.div>
        
        <motion.h1
          variants={fadeInY}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mb-7 font-display text-5xl font-black leading-none tracking-tighter md:text-6xl lg:text-7xl"
        >
          YOUR{" "}
          <span className="gradient-text">JOB SEARCH</span>
          <br />
          COMMAND CENTER
        </motion.h1>
        
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mb-10 max-w-2xl text-lg font-medium text-[var(--text-secondary)] md:text-xl"
        >
          {SITE_CONFIG.description}
        </motion.p>
        
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href={SITE_CONFIG.github}
            target="_blank"
            rel="noopener noreferrer"
            className="geo-card-solid inline-flex items-center gap-3 px-8 py-4 text-black font-bold text-lg"
          >
            <GithubIcon className="w-5 h-5" />
            VIEW ON GITHUB
            <ArrowRight className="w-5 h-5" />
          </a>
          
          <a
            href="#setup"
            className="geo-card inline-flex items-center gap-3 px-8 py-4 text-[var(--text-primary)] font-bold text-lg"
          >
            GET STARTED
            <ArrowRight className="w-5 h-5" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
