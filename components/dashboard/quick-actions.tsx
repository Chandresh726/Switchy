"use client";

import { Button } from "@/components/ui/button";
import { Plus, Briefcase, User } from "lucide-react";
import Link from "next/link";

interface QuickActionsProps {
  onAddCompany?: () => void;
}

export function QuickActions({ onAddCompany }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={onAddCompany}>
        <Plus className="h-4 w-4" />
        Add Company
      </Button>
      <Link href="/jobs">
        <Button variant="outline">
          <Briefcase className="h-4 w-4" />
          View All Jobs
        </Button>
      </Link>
      <Link href="/profile">
        <Button variant="outline">
          <User className="h-4 w-4" />
          Edit Profile
        </Button>
      </Link>
    </div>
  );
}
