import { card } from "@/components/ui";

// Shown while a quote opens.
export default function Loading() {
  return (
    <main className="mx-auto flex w-[min(1100px,calc(100%-40px))] flex-col gap-5 pb-16 pt-6" aria-busy="true">
      <p role="status" className="text-sm text-muted">
        Loading the quote…
      </p>
      <div className={`${card} h-24 animate-pulse bg-white`} />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${card} h-56 animate-pulse bg-white`} />
        ))}
      </div>
      <div className={`${card} h-64 animate-pulse bg-white`} />
    </main>
  );
}
