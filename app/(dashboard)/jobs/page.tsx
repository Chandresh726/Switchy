"use client";

import { JobList } from "@/components/jobs/job-list";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

function JobsPageContent() {
  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Jobs</h1>
        <p className="mt-1 text-zinc-400">Browse and manage job opportunities</p>
      </div>

      {/* Job List */}
      <JobList />
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    }>
      <JobsPageContent />
    </Suspense>
  );
}
