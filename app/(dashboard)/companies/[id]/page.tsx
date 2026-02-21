"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/empty-state";

import {
  CompanyHeader,
  CompanyStats,
  CompanyActions,
  CompanyTabs,
  CompanyJobsTab,
  CompanyConnectionsTab,
  CompanyActivityTab,
  type CompanyOverviewResponse,
  type Tab,
} from "@/components/companies/company-detail";

export default function CompanyOverviewPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("jobs");

  const companyId = Number(params.id);

  const { data, isLoading } = useQuery<CompanyOverviewResponse>({
    queryKey: ["company-overview", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/overview`);
      if (!res.ok) throw new Error("Failed to fetch company overview");
      return res.json();
    },
    enabled: Number.isFinite(companyId),
  });

  const refreshJobsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/companies/refresh-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds: [companyId] }),
      });
      if (!res.ok) throw new Error("Failed to refresh jobs");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["company-overview", companyId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(result.message || "Jobs refreshed successfully");
    },
    onError: () => {
      toast.error("Failed to refresh jobs");
    },
  });

  const runMatchingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/companies/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds: [companyId] }),
      });
      if (!res.ok) throw new Error("Failed to run matching");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["company-overview", companyId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["match-history"] });
      toast.success(result.message || "Matching completed successfully");
    },
    onError: () => {
      toast.error("Failed to run matching");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={Building2}
        title="Company not found"
        description="We could not load this company overview."
      />
    );
  }

  return (
    <div className="space-y-6">
      <CompanyHeader company={data.company} />

      <CompanyStats stats={data.stats} />

      <CompanyTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        rightSlot={
          <CompanyActions
            isRefreshing={refreshJobsMutation.isPending}
            isMatching={runMatchingMutation.isPending}
            onRefreshJobs={() => refreshJobsMutation.mutate()}
            onRunMatching={() => runMatchingMutation.mutate()}
          />
        }
      />

      <div className="pt-2">
        {activeTab === "jobs" && <CompanyJobsTab jobs={data.jobs} />}
        {activeTab === "connections" && <CompanyConnectionsTab connections={data.connections} />}
        {activeTab === "activity" && <CompanyActivityTab activity={data.activity} />}
      </div>
    </div>
  );
}
