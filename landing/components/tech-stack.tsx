"use client";

import Image from "next/image";
import { motion } from "framer-motion";

import { PROVIDERS } from "@/lib/constants";
import { fadeInUp, getScaleDelay } from "@/lib/animations";

export function TechStack() {
  return (
    <section className="px-6 py-24 border-t-2 border-[var(--border-color)]">
      <div className="max-w-5xl mx-auto">
        <motion.div
          variants={fadeInUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="font-display text-3xl md:text-4xl font-black mb-4">
            SUPPORTED <span className="gradient-text">AI PROVIDERS</span>
          </h2>
          <p className="text-[var(--text-secondary)] max-w-xl mx-auto">
            Bring your own API key. Your data never leaves your machine.
          </p>
        </motion.div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {PROVIDERS.map((provider, index) => (
            <motion.div
              key={provider.name}
              variants={getScaleDelay(index, 0.05)}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              className="geo-card p-6 flex flex-col items-center justify-center gap-3"
            >
              <Image
                src={provider.logo}
                alt={`${provider.name} logo`}
                width={48}
                height={48}
                className="w-12 h-12 object-contain"
              />
              <span className="font-medium text-sm text-center">{provider.name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
