"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CompanyForm } from "@/components/companies/company-form";
import { CompanyList } from "@/components/companies/company-list";
import { Plus } from "lucide-react";

export default function CompaniesPage() {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Companies</h1>
          <p className="mt-1 text-zinc-400">
            Track companies and their job openings
          </p>
        </div>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4" />
            Add Company
          </Button>
        )}
      </div>

      {/* Add Company Form */}
      {isAdding && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <CompanyForm
            onSuccess={() => setIsAdding(false)}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      {/* Company List */}
      <CompanyList />
    </div>
  );
}
