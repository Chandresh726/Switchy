export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 bg-[#10b981] border-2 border-[var(--border-color)] flex items-center justify-center -skew-x-6 animate-pulse">
          <span className="text-black skew-x-6 text-2xl">⚡</span>
        </div>
        <div className="h-2 w-32 bg-[var(--bg-tertiary)] rounded overflow-hidden">
          <div className="h-full bg-[#10b981] animate-[shimmer_1.5s_infinite]" />
        </div>
      </div>
    </div>
  );
}
