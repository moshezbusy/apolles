import { card } from "@/components/ui";

// Shown while the quote list loads (a tab, a search, "Load more").
export default function Loading() {
  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] pb-16 pt-8" aria-busy="true">
      <p role="status" className="text-sm text-muted">
        Loading quotes…
      </p>
      <div className="mt-5 flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${card} h-28 animate-pulse bg-white`} />
        ))}
      </div>
    </main>
  );
}
