"use client";

import { Input } from "@/components/ui/input";
import { Search, X, ArrowUpDown, MapPin, Building2 } from "lucide-react";
import { useMemo, useState, useRef, useEffect } from "react";

interface JobFilters {
  search: string;
  status: string;
  companyId: string;
  companyIds: string[];
  locationType: string[];
  employmentType: string[];
  minScore: string;
  department: string;
  locationSearch: string;
  sortBy: string;
  sortOrder: string;
}

interface JobFiltersProps {
  filters: JobFilters;
  onFiltersChange: (filters: JobFilters) => void;
  companies: { id: number; name: string }[];
  departments?: string[];
  hideStatusFilter?: boolean;
}

const LOCATION_TYPE_OPTIONS = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

const SCORE_OPTIONS = [
  { value: "", label: "Any Score" },
  { value: "75", label: "75%+" },
  { value: "60", label: "60%+" },
  { value: "45", label: "45%+" },
  { value: "30", label: "30%+" },
];

const SORT_OPTIONS = [
  { value: "matchScore", label: "Match Score" },
  { value: "discoveredAt", label: "Date Added" },
  { value: "postedDate", label: "Date Posted" },
  { value: "companyName", label: "Company" },
  { value: "title", label: "Job Title" },
];

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs text-emerald-400">
      {label}
      <button
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-emerald-500/30"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TogglePill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        selected
          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
          : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function CompanyMultiSelect({
  companies,
  selectedIds,
  onChange,
}: {
  companies: { id: number; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleCompany = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((i) => i !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectedCount = selectedIds.length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          selectedCount > 0
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"
        }`}
      >
        <Building2 className="h-3 w-3" />
        {selectedCount > 0 ? `${selectedCount} Companies` : "Companies"}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg">
          <div className="p-2">
            <Input
              placeholder="Search companies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-48 overflow-auto px-1 pb-2">
            {filteredCompanies.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-500">No companies found</div>
            ) : (
              filteredCompanies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => toggleCompany(company.id.toString())}
                  className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedIds.includes(company.id.toString())
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  <div
                    className={`h-3 w-3 rounded border ${
                      selectedIds.includes(company.id.toString())
                        ? "border-emerald-500 bg-emerald-500"
                        : "border-zinc-600"
                    }`}
                  >
                    {selectedIds.includes(company.id.toString()) && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12">
                        <path
                          fill="currentColor"
                          d="M10.28 2.28a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06L4.25 7.19l4.97-4.97a.75.75 0 0 1 1.06 0z"
                        />
                      </svg>
                    )}
                  </div>
                  {company.name}
                </button>
              ))
            )}
          </div>
          {selectedCount > 0 && (
            <div className="border-t border-zinc-700 p-2">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-zinc-400 hover:text-zinc-200"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function JobFilters({
  filters,
  onFiltersChange,
  companies,
}: JobFiltersProps) {
  // Ensure companyIds is always an array
  const companyIds = filters.companyIds || [];

  // Calculate active filter chips
  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];

    companyIds.forEach((cid) => {
      const companyName = companies.find((c) => c.id === parseInt(cid))?.name || "Company";
      chips.push({
        key: `company-${cid}`,
        label: companyName,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            companyIds: companyIds.filter((id) => id !== cid),
          }),
      });
    });

    filters.locationType.forEach((lt) => {
      const label = LOCATION_TYPE_OPTIONS.find((o) => o.value === lt)?.label || lt;
      chips.push({
        key: `locationType-${lt}`,
        label,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            locationType: filters.locationType.filter((t) => t !== lt),
          }),
      });
    });

    filters.employmentType.forEach((et) => {
      const label = EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === et)?.label || et;
      chips.push({
        key: `employmentType-${et}`,
        label,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            employmentType: filters.employmentType.filter((t) => t !== et),
          }),
      });
    });

    if (filters.minScore) {
      chips.push({
        key: "minScore",
        label: `Score: ${filters.minScore}%+`,
        onRemove: () => onFiltersChange({ ...filters, minScore: "" }),
      });
    }

    if (filters.department) {
      chips.push({
        key: "department",
        label: `Dept: ${filters.department}`,
        onRemove: () => onFiltersChange({ ...filters, department: "" }),
      });
    }

    if (filters.locationSearch) {
      chips.push({
        key: "locationSearch",
        label: `Location: ${filters.locationSearch}`,
        onRemove: () => onFiltersChange({ ...filters, locationSearch: "" }),
      });
    }

    return chips;
  }, [filters, companies, onFiltersChange, companyIds]);

  const hasActiveFilters = activeFilters.length > 0;

  const clearAllFilters = () => {
    onFiltersChange({
      search: filters.search,
      status: "",
      companyId: "",
      companyIds: [],
      locationType: [],
      employmentType: [],
      minScore: "",
      department: "",
      locationSearch: "",
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });
  };

  const toggleLocationType = (value: string) => {
    const current = filters.locationType;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, locationType: updated });
  };

  const toggleEmploymentType = (value: string) => {
    const current = filters.employmentType;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, employmentType: updated });
  };

  return (
    <div className="space-y-3">
      {/* Search Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search job titles, descriptions..."
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            className="pl-9"
          />
        </div>
        <div className="relative">
          <MapPin className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Location..."
            value={filters.locationSearch}
            onChange={(e) =>
              onFiltersChange({ ...filters, locationSearch: e.target.value })
            }
            className="w-36 pl-8"
          />
        </div>
      </div>

      {/* Filter Pills Row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Company Multi-Select */}
        <CompanyMultiSelect
          companies={companies}
          selectedIds={companyIds}
          onChange={(ids) => onFiltersChange({ ...filters, companyIds: ids })}
        />

        {/* Divider */}
        <div className="h-5 w-px bg-zinc-700" />

        {/* Location Type Pills */}
        {LOCATION_TYPE_OPTIONS.map((opt) => (
          <TogglePill
            key={opt.value}
            selected={filters.locationType.includes(opt.value)}
            onClick={() => toggleLocationType(opt.value)}
          >
            {opt.label}
          </TogglePill>
        ))}

        {/* Divider */}
        <div className="h-5 w-px bg-zinc-700" />

        {/* Employment Type Pills */}
        {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
          <TogglePill
            key={opt.value}
            selected={filters.employmentType.includes(opt.value)}
            onClick={() => toggleEmploymentType(opt.value)}
          >
            {opt.label}
          </TogglePill>
        ))}

        {/* Divider */}
        <div className="h-5 w-px bg-zinc-700" />

        {/* Score Filter */}
        <select
          value={filters.minScore}
          onChange={(e) =>
            onFiltersChange({ ...filters, minScore: e.target.value })
          }
          className="h-7 rounded-full border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300"
        >
          {SCORE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sort */}
        <div className="flex items-center gap-1">
          <ArrowUpDown className="h-3.5 w-3.5 text-zinc-500" />
          <select
            value={filters.sortBy}
            onChange={(e) =>
              onFiltersChange({ ...filters, sortBy: e.target.value })
            }
            className="h-7 rounded-full border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              onFiltersChange({
                ...filters,
                sortOrder: filters.sortOrder === "desc" ? "asc" : "desc",
              })
            }
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            title={filters.sortOrder === "desc" ? "Descending" : "Ascending"}
          >
            {filters.sortOrder === "desc" ? "↓" : "↑"}
          </button>
        </div>
      </div>

      {/* Active Filters Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              onRemove={chip.onRemove}
            />
          ))}
          <button
            onClick={clearAllFilters}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
