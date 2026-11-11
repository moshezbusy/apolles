import { card } from "@/components/ui";

// Shown while a results page loads (a new search, a filter, a page of results).
export default function Loading() {
  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-6" aria-busy="true">
      <p role="status" className="text-sm text-muted">
        Loading hotels…
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${card} h-44 animate-pulse bg-white`} />
        ))}
      </div>
    </main>
  );
}
