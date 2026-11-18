// Plan 8f: what the rate includes (meal plan, perks), exactly as the supplier named it. Nothing
// listed → nothing shown (never "Room only": we cannot know that).
export function RateIncludes({ amenities, label = "Rate includes", className = "text-[13px] text-[#37413d]" }: { amenities: readonly string[]; label?: string; className?: string }) {
  if (amenities.length === 0) return null;
  return (
    <p className={className}>
      <strong className="font-semibold">{label}:</strong> {amenities.join(", ")}
    </p>
  );
}
