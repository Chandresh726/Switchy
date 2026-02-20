interface SectionDividerProps {
  top: "grid" | "plain";
  bottom: "grid" | "plain";
}

export function SectionDivider({ top, bottom }: SectionDividerProps) {
  return (
    <div aria-hidden className="relative h-24">
      <div className={`absolute inset-x-0 top-0 h-1/2 ${top === "grid" ? "grid-bg" : ""}`} />
      <div className={`absolute inset-x-0 bottom-0 h-1/2 ${bottom === "grid" ? "grid-bg" : ""}`} />
      <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 border-t-2 border-[var(--border-color)]" />
    </div>
  );
}
