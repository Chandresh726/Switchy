"use client";

import { Input } from "@/components/ui/input";
import { Search, X, ArrowUpDown, MapPin, Building2, Loader2, Briefcase } from "lucide-react";
import { useMemo, useState, useRef, useEffect } from "react";

interface JobFilters {
  search: string;
  status: string;
  companyIds: string[];
  locationType: string[];
  employmentType: string[];
  seniorityLevel: string[];
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
  totalCount?: number;
  isFetching?: boolean;
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

const SENIORITY_LEVEL_OPTIONS = [
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "manager", label: "Manager" },
  { value: "director", label: "Director" },
  { value: "executive", label: "Executive" },
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
          : "bg-muted text-muted-foreground border border-border hover:bg-muted hover:text-foreground"
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
            : "bg-muted text-muted-foreground border border-border hover:bg-muted hover:text-foreground"
        }`}
      >
        <Building2 className="h-3 w-3" />
        {selectedCount > 0 ? `${selectedCount} Companies` : "Companies"}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card shadow-lg">
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
              <div className="px-3 py-2 text-xs text-muted-foreground">No companies found</div>
            ) : (
              filteredCompanies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => toggleCompany(company.id.toString())}
                  className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedIds.includes(company.id.toString())
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-foreground/80 hover:bg-muted"
                  }`}
                >
                  <div
                    className={`h-3 w-3 rounded border ${
                      selectedIds.includes(company.id.toString())
                        ? "border-emerald-500 bg-emerald-500"
                        : "border-border"
                    }`}
                  >
                    {selectedIds.includes(company.id.toString()) && (
                      <svg className="h-3 w-3 text-foreground" viewBox="0 0 12 12">
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
            <div className="border-t border-border p-2">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-muted-foreground hover:text-foreground"
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

function OptionMultiSelect({
  options,
  selectedValues,
  onChange,
  label,
  icon: Icon,
}: {
  options: { value: string; label: string }[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
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

  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const selectedCount = selectedValues.length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          selectedCount > 0
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            : "bg-muted text-muted-foreground border border-border hover:bg-muted hover:text-foreground"
        }`}
      >
        {Icon && <Icon className="h-3 w-3" />}
        {selectedCount > 0 ? `${selectedCount} ${label}` : label}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg">
          <div className="max-h-48 overflow-auto px-1 py-2">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => toggleOption(opt.value)}
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors ${
                  selectedValues.includes(opt.value)
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-foreground/80 hover:bg-muted"
                }`}
              >
                <div
                  className={`h-3 w-3 rounded border ${
                    selectedValues.includes(opt.value)
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-border"
                  }`}
                >
                  {selectedValues.includes(opt.value) && (
                    <svg className="h-3 w-3 text-foreground" viewBox="0 0 12 12">
                      <path
                        fill="currentColor"
                        d="M10.28 2.28a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06L4.25 7.19l4.97-4.97a.75.75 0 0 1 1.06 0z"
                      />
                    </svg>
                  )}
                </div>
                {opt.label}
              </button>
            ))}
          </div>
          {selectedCount > 0 && (
            <div className="border-t border-border p-2">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-muted-foreground hover:text-foreground"
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
  totalCount,
  isFetching,
}: JobFiltersProps) {
  // Ensure companyIds is always an array
  const companyIds = useMemo(() => filters.companyIds || [], [filters.companyIds]);

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

    filters.seniorityLevel.forEach((sl) => {
      const label = SENIORITY_LEVEL_OPTIONS.find((o) => o.value === sl)?.label || sl;
      chips.push({
        key: `seniorityLevel-${sl}`,
        label,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            seniorityLevel: filters.seniorityLevel.filter((t) => t !== sl),
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
      companyIds: [],
      locationType: [],
      employmentType: [],
      seniorityLevel: [],
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

  return (
    <div className="space-y-3">
      {/* Search Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
          <MapPin className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
        {/* Job Count */}
        <div className="flex items-center gap-2 pr-2">
          <span className="text-sm text-muted-foreground">
            {totalCount ?? 0} {(totalCount ?? 0) === 1 ? "job" : "jobs"}
          </span>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-muted" />

        {/* Company Multi-Select */}
        <CompanyMultiSelect
          companies={companies}
          selectedIds={companyIds}
          onChange={(ids) => onFiltersChange({ ...filters, companyIds: ids })}
        />

        {/* Divider */}
        <div className="h-5 w-px bg-muted" />

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
        <div className="h-5 w-px bg-muted" />

        {/* Employment Type Multi-Select */}
        <OptionMultiSelect
          options={EMPLOYMENT_TYPE_OPTIONS}
          selectedValues={filters.employmentType}
          onChange={(values) => onFiltersChange({ ...filters, employmentType: values })}
          label="Job Type"
          icon={Briefcase}
        />

        {/* Divider */}
        <div className="h-5 w-px bg-muted" />

        {/* Seniority Level Multi-Select */}
        <OptionMultiSelect
          options={SENIORITY_LEVEL_OPTIONS}
          selectedValues={filters.seniorityLevel}
          onChange={(values) => onFiltersChange({ ...filters, seniorityLevel: values })}
          label="Seniority"
        />

        {/* Divider */}
        <div className="h-5 w-px bg-muted" />

        {/* Score Filter */}
        <select
          value={filters.minScore}
          onChange={(e) =>
            onFiltersChange({ ...filters, minScore: e.target.value })
          }
          className="h-7 rounded-full border border-border bg-muted px-3 text-xs text-foreground/80"
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
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={filters.sortBy}
            onChange={(e) =>
              onFiltersChange({ ...filters, sortBy: e.target.value })
            }
            className="h-7 rounded-full border border-border bg-muted px-3 text-xs text-foreground/80"
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
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
            className="text-xs text-muted-foreground hover:text-foreground/80"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
