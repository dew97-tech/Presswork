export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-3 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-7 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-lg border border-border bg-card motion-reduce:animate-none"
          />
        ))}
      </div>

      <div className="h-72 animate-pulse rounded-lg border border-border bg-card motion-reduce:animate-none" />
      <div className="h-96 animate-pulse rounded-lg border border-border bg-card motion-reduce:animate-none" />

      <p className="sr-only">Loading Search Console data.</p>
    </div>
  );
}
