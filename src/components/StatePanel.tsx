import { card } from "@/components/ui";

// A system state (screen 24): icon, title, text, actions. The message never shows technical
// details or the supplier's name.
export function StatePanel({ icon, tone, title, children, actions, footnote }: { icon: string; tone: "neutral" | "warn"; title: string; children: React.ReactNode; actions: React.ReactNode; footnote?: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={`w-full max-w-[500px] p-8 text-center ${card} bg-white`}>
        <div aria-hidden="true" className={`mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full font-serif text-[22px] ${tone === "warn" ? "bg-[#fff2c7] text-[#8a6d1f]" : "bg-[#eef3f0] text-[#4d5a54]"}`}>
          {icon}
        </div>
        <h1 className="mb-2 font-serif text-[26px] font-medium leading-tight text-ink">{title}</h1>
        <div className="mb-6 text-sm text-muted">{children}</div>
        <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
        {footnote ? <p className="mt-4 text-xs text-muted">{footnote}</p> : null}
      </div>
    </main>
  );
}
