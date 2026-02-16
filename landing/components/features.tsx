"use client";

import { motion } from "framer-motion";

import { FEATURES, FEATURE_COLORS } from "@/lib/constants";
import { fadeInUp, getSlideDelay } from "@/lib/animations";

export function Features() {
  return (
    <section id="features" className="px-6 py-32 grid-bg relative">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={fadeInUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <h2 className="font-display text-4xl md:text-6xl font-black mb-6 tracking-tight">
            EVERYTHING TO{" "}
            <span className="gradient-text">LAND YOUR DREAM JOB</span>
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-2xl mx-auto font-medium">
            A complete toolkit for the modern job seeker. Automate the tedious parts,
            focus on what matters—getting hired.
          </p>
        </motion.div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              variants={getSlideDelay(index, 0.08)}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              className="geo-card p-8"
            >
              <div className={`w-14 h-14 ${FEATURE_COLORS[feature.color]} flex items-center justify-center mb-5 border-2 border-[var(--border-color)]`}>
                <feature.icon className="w-7 h-7" />
              </div>
              <h3 className="font-display text-xl font-bold text-[var(--text-primary)] mb-3">{feature.title}</h3>
              <p className="text-[var(--text-secondary)] leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
