"use client";

import { motion } from "framer-motion";

import { STEPS } from "@/lib/constants";
import { fadeInUp, getSlideDelay } from "@/lib/animations";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 py-32 grid-bg relative">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={fadeInUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <h2 className="font-display text-4xl md:text-6xl font-black mb-4">
            HOW IT <span className="gradient-text">WORKS</span>
          </h2>
          <p className="text-[var(--text-secondary)] text-lg">Four simple steps to transform your job search from chaos to clarity.</p>
        </motion.div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {STEPS.map((step, index) => (
            <motion.div
              key={step.number}
              variants={getSlideDelay(index, 0.15)}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              className="relative"
            >
              <div className="geo-card p-6 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-[#10b981] border-2 border-[var(--border-color)] flex items-center justify-center">
                  <step.icon className="w-8 h-8 text-black" />
                </div>
                <div className="absolute -top-3 -right-3 w-8 h-8 bg-[#34d399] border-2 border-[var(--border-color)] flex items-center justify-center text-xs font-bold text-black">
                  {step.number}
                </div>
                <h3 className="font-display text-lg font-bold text-[var(--text-primary)] mb-2">{step.title}</h3>
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
