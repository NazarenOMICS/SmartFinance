export function SkeletonCard({ className = "" }) {
  return (
    <div className={`rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-panel animate-pulse dark:border-white/10 dark:bg-neutral-900/85 ${className}`}>
      <div className="h-3 w-24 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      <div className="mt-4 h-8 w-36 rounded-full bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

export function SkeletonPanel({ rows = 4, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-panel dark:border-white/10 dark:bg-neutral-900/90 animate-pulse ${className}`}>
      <div className="border-b border-neutral-100 dark:border-neutral-800 px-5 py-4 flex gap-4 items-center">
        <div className="h-3 w-32 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-3 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 last:border-0">
          <div className="h-3 w-14 rounded-full bg-neutral-200 dark:bg-neutral-700 shrink-0" />
          <div className="h-3 flex-1 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-20 rounded-full bg-neutral-200 dark:bg-neutral-700 shrink-0" />
          <div className="h-3 w-24 rounded-full bg-neutral-200 dark:bg-neutral-700 shrink-0" />
          <div className="h-6 w-28 rounded-full bg-neutral-200 dark:bg-neutral-700 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0,1,2,3].map(i => <SkeletonCard key={i} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <SkeletonPanel rows={5} />
        <SkeletonPanel rows={3} />
      </div>
      <SkeletonPanel rows={6} />
    </div>
  );
}
