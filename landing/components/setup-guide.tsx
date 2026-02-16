"use client";

import { motion } from "framer-motion";
import { Terminal, Copy, Check } from "lucide-react";
import { useState } from "react";

import { SETUP_STEPS } from "@/lib/constants";
import { fadeInUp, slideInX } from "@/lib/animations";

export function SetupGuide() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  
  const copyToClipboard = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };
  
  return (
    <section id="setup" className="px-6 py-32 relative">
      <div className="max-w-4xl mx-auto">
        <motion.div
          variants={fadeInUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-display text-4xl md:text-6xl font-black mb-4">
            GET <span className="gradient-text">STARTED</span> IN MINUTES
          </h2>
          <p className="text-[var(--text-secondary)] text-lg">Follow these simple steps to set up Switchy on your local machine.</p>
        </motion.div>
        
        <div className="space-y-4">
          {SETUP_STEPS.map((item, index) => (
            <motion.div
              key={item.step}
              variants={slideInX}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="geo-card rounded-none overflow-hidden"
            >
              <div className="p-6">
                <div className="flex flex-col md:flex-row items-start gap-4">
                  <div className="w-12 h-12 bg-[#10b981] border-2 border-[var(--border-color)] flex items-center justify-center text-black font-bold flex-shrink-0">
                    {item.step}
                  </div>
                  <div className="flex-1 w-full">
                    <h3 className="font-display text-lg font-bold text-[var(--text-primary)] mb-1">{item.title}</h3>
                    <p className="text-[var(--text-secondary)] text-sm mb-3">{item.description}</p>
                    
                    <div className="relative">
                      <div className="flex items-center gap-2 bg-[var(--bg-primary)] border-2 border-[var(--border-color)] p-3 pr-14 overflow-x-auto">
                        <Terminal className="w-4 h-4 text-[#10b981] flex-shrink-0" />
                        <code className="text-sm text-[#34d399] font-mono whitespace-nowrap">{item.code}</code>
                      </div>
                      <button onClick={() => copyToClipboard(item.code, index)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 border-2 border-[var(--border-color)] hover:bg-[#10b981] hover:text-black transition-colors bg-[var(--bg-primary)]" aria-label="Copy to clipboard">
                        {copiedIndex === index ? <Check className="w-4 h-4 text-black" /> : <Copy className="w-4 h-4 text-[var(--text-primary)]" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
