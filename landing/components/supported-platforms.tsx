"use client";

import Image from "next/image";
import { motion } from "framer-motion";

import { PLATFORMS } from "@/lib/constants";
import { fadeInUp, getScaleDelay } from "@/lib/animations";

export function SupportedPlatforms() {
  return (
    <section id="platforms" className="px-6 py-24 grid-bg">
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
            SUPPORTED JOB LISTING <span className="gradient-text">PLATFORMS</span>
          </h2>
          <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">
            Switchy scrapes listings from the top ATS and recruiting platforms.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {PLATFORMS.map((platform, index) => (
            <motion.div
              key={platform.name}
              variants={getScaleDelay(index, 0.05)}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              className="geo-card p-6 flex flex-col items-center justify-center gap-3"
            >
              <Image
                src={platform.logo}
                alt={`${platform.name} logo`}
                width={56}
                height={56}
                className="w-14 h-14 object-contain"
              />
              <span className="font-medium text-sm text-center">{platform.name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
