import { cn } from "@/lib/utils";

interface TogglePillProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

export function TogglePill({ selected, onClick, children, className }: TogglePillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center px-3 text-xs font-medium transition-colors",
        selected
          ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
          : "border border-border bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}
