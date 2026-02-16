"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { FAQS } from "@/lib/constants";
import { fadeInUp, accordionContent } from "@/lib/animations";

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  
  return (
    <section id="faq" className="px-6 py-32 grid-bg border-t-2 border-[var(--border-color)]">
      <div className="max-w-3xl mx-auto">
        <motion.div
          variants={fadeInUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-4xl md:text-6xl font-black mb-4">
            FAQ
          </h2>
        </motion.div>
        
        <div className="space-y-3">
          {FAQS.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className="geo-card rounded-none overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full p-5 flex items-center justify-between text-left"
                aria-expanded={openIndex === index}
              >
                <span className="font-bold text-[var(--text-primary)] pr-4">{faq.question}</span>
                <ChevronDown className={`w-5 h-5 text-[var(--text-primary)] transition-transform duration-300 flex-shrink-0 ${openIndex === index ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {openIndex === index && (
                  <motion.div
                    variants={accordionContent}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 text-zinc-400 leading-relaxed">{faq.answer}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
