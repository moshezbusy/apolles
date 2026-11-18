// "✓ Choose hotel · ✓ Choose room · 3 Guest details · 4 Review & book" (screens 10, 11).
export function Steps({ current }: { current: 3 | 4 }) {
  const steps = ["Choose hotel", "Choose room", "Guest details", "Review & book"];
  return (
    <ol aria-label="Booking steps" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={s} aria-current={n === current ? "step" : undefined} className={done ? "text-brand" : n === current ? "text-ink" : "text-muted"}>
            {done ? "✓" : n} {s}
          </li>
        );
      })}
    </ol>
  );
}
