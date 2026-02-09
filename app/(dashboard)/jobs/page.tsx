"use client";

import { JobList } from "@/components/jobs/job-list";

export default function JobsPage() {
  return (
    <div className="h-full">
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
