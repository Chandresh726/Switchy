import Link from "next/link";
import { Home, ArrowLeft } from "lucide-react";

import { SITE_CONFIG } from "@/lib/constants";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-6">
      <div className="max-w-md text-center">
        <div className="font-display text-8xl font-black text-[var(--text-primary)] mb-4">
          404
        </div>
        <h1 className="font-display text-3xl font-bold text-[var(--text-primary)] mb-4">
          Page Not Found
        </h1>
        <p className="text-[var(--text-secondary)] mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/"
            className="geo-card-solid inline-flex items-center gap-2 px-6 py-3 text-black font-bold"
          >
            <Home className="w-4 h-4" />
            Back Home
          </Link>
          <a
            href={SITE_CONFIG.github}
            target="_blank"
            rel="noopener noreferrer"
            className="geo-card inline-flex items-center gap-2 px-6 py-3 text-[var(--text-primary)] font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
