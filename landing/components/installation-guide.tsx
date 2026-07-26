"use client";

import { useState } from "react";

import { motion } from "framer-motion";
import { Check, Copy, Terminal } from "lucide-react";

import { GithubIcon } from "@/components/icons";
import { fadeInUp, slideInX } from "@/lib/animations";
import {
  INSTALL_COMMAND,
  SOURCE_INSTALL_STEPS,
} from "@/lib/constants";

type InstallationMethod = "quick" | "source";

interface CommandBlockProps {
  code: string;
  copied: boolean;
  onCopy: (code: string) => Promise<void>;
}

function CommandBlock({ code, copied, onCopy }: CommandBlockProps) {
  return (
    <div className="relative">
      <div className="flex items-center gap-3 overflow-x-auto border-2 border-[var(--border-color)] bg-[var(--bg-primary)] p-4 pr-16 md:p-5 md:pr-16">
        <Terminal className="h-5 w-5 flex-shrink-0 text-[#10b981]" />
        <code className="whitespace-nowrap font-mono text-sm font-bold text-[#34d399] md:text-base">
          {code}
        </code>
      </div>
      <button
        type="button"
        onClick={() => void onCopy(code)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 border-2 border-[var(--border-color)] p-2.5 transition-colors hover:bg-[#10b981] hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10b981] ${
          copied ? "bg-[#10b981] text-black" : "bg-[var(--bg-primary)]"
        }`}
        aria-label={copied ? "Command copied" : "Copy command"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-black" />
        ) : (
          <Copy className="h-4 w-4 text-[var(--text-primary)]" />
        )}
      </button>
    </div>
  );
}

export function InstallationGuide() {
  const [method, setMethod] = useState<InstallationMethod>("quick");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyToClipboard = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => {
      setCopiedCode((current) => current === code ? null : current);
    }, 2000);
  };

  return (
    <section id="installation" className="relative px-6 py-32">
      <div className="mx-auto max-w-5xl">
        <motion.div
          variants={fadeInUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
        >
          <h2 className="mb-4 font-display text-4xl font-black tracking-tight md:text-6xl">
            INSTALL <span className="gradient-text">SWITCHY</span>
          </h2>
          <p className="mx-auto max-w-2xl text-lg font-medium text-[var(--text-secondary)]">
            Start locally with one command, or build directly from the source.
          </p>
        </motion.div>

        <div
          className="mx-auto mb-10 grid max-w-xl grid-cols-2 border-2 border-[var(--border-color)] bg-[var(--bg-secondary)] p-1.5"
          role="group"
          aria-label="Installation method"
        >
          <button
            type="button"
            onClick={() => setMethod("quick")}
            aria-pressed={method === "quick"}
            className={`flex min-h-14 items-center justify-center gap-2 border-2 px-3 py-2 font-display text-sm font-bold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10b981] md:text-base ${
              method === "quick"
                ? "border-[var(--border-color)] bg-[#10b981] text-black"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Terminal className="h-4 w-4" />
            QUICK START
          </button>
          <button
            type="button"
            onClick={() => setMethod("source")}
            aria-pressed={method === "source"}
            className={`flex min-h-14 items-center justify-center gap-2 border-2 px-3 py-2 font-display text-sm font-bold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10b981] md:text-base ${
              method === "source"
                ? "border-[var(--border-color)] bg-[#10b981] text-black"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <GithubIcon className="h-4 w-4" />
            FROM SOURCE
          </button>
        </div>

        {method === "quick" ? (
          <motion.div
            key="quick"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="geo-card overflow-hidden"
          >
            <div className="flex flex-col gap-4 border-b-2 border-[var(--border-color)] bg-[#10b981] px-6 py-5 text-black sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-display text-xl font-black">ONE COMMAND. LOCAL APP.</p>
                <p className="mt-1 text-sm font-bold">
                  Requires Node.js 24 with npm.
                </p>
              </div>
              <span className="w-fit border-2 border-black bg-black px-3 py-1 font-mono text-xs font-bold tracking-widest text-white">
                RECOMMENDED
              </span>
            </div>
            <div className="p-6 md:p-8">
              <p className="mb-5 text-[var(--text-secondary)]">
                Run this command to download the correct runtime and start
                Switchy on your device.
              </p>
              <CommandBlock
                code={INSTALL_COMMAND}
                copied={copiedCode === INSTALL_COMMAND}
                onCopy={copyToClipboard}
              />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="source"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            {SOURCE_INSTALL_STEPS.map((item, index) => (
              <motion.div
                key={item.step}
                variants={slideInX}
                initial="initial"
                whileInView="animate"
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="geo-card overflow-hidden rounded-none"
              >
                <div className="p-6">
                  <div className="flex flex-col items-start gap-4 md:flex-row">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center border-2 border-[var(--border-color)] bg-[#10b981] font-bold text-black">
                      {item.step}
                    </div>
                    <div className="w-full flex-1">
                      <h3 className="mb-1 font-display text-lg font-bold text-[var(--text-primary)]">
                        {item.title}
                      </h3>
                      <p className="mb-3 text-sm text-[var(--text-secondary)]">
                        {item.description}
                      </p>

                      <CommandBlock
                        code={item.code}
                        copied={copiedCode === item.code}
                        onCopy={copyToClipboard}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </section>
  );
}
