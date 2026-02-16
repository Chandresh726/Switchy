"use client";

import { motion } from "framer-motion";
import { ArrowRight, Github, Sparkles } from "lucide-react";

import { SITE_CONFIG, SOCIAL_LINKS } from "@/lib/constants";
import { fadeInScale, fadeInY } from "@/lib/animations";

export function Hero() {
  return (
    <section className="relative flex items-center justify-center px-6 pt-48 pb-40 grid-bg overflow-hidden">
      <div className="relative z-10 max-w-6xl mx-auto text-center">
        <motion.div
          variants={fadeInScale}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-3 px-6 py-3 border-2 border-[var(--border-color)] bg-[var(--bg-primary)] mb-12"
        >
          <Sparkles className="w-5 h-5 text-[#10b981]" />
          <span className="font-bold text-[var(--text-primary)] tracking-wide">OPEN SOURCE • LOCAL FIRST</span>
        </motion.div>
        
        <motion.h1
          variants={fadeInY}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-display text-5xl md:text-6xl lg:text-7xl font-black tracking-tighter mb-12 leading-none"
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
          className="text-lg md:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-16 font-medium"
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
            href={SOCIAL_LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            className="geo-card-solid inline-flex items-center gap-3 px-8 py-4 text-black font-bold text-lg"
          >
            <Github className="w-5 h-5" />
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
