"use client";

import { useEffect } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";

import { SITE_CONFIG } from "@/lib/constants";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-6">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-[#ef4444] border-2 border-[var(--border-color)] flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-white" />
        </div>
        <h1 className="font-display text-3xl font-bold text-[var(--text-primary)] mb-4">
          Something went wrong
        </h1>
        <p className="text-[var(--text-secondary)] mb-8">
          An unexpected error occurred. Please try again.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={reset}
            className="geo-card-solid inline-flex items-center gap-2 px-6 py-3 text-black font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            Try Again
          </button>
          <a
            href={SITE_CONFIG.github}
            target="_blank"
            rel="noopener noreferrer"
            className="geo-card inline-flex items-center gap-2 px-6 py-3 text-[var(--text-primary)] font-bold"
          >
            Report Issue
          </a>
        </div>
      </div>
    </div>
  );
}
