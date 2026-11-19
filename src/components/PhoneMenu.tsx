import type { ReactNode } from "react";

// The header's "Menu" button on phones (plan 9): a <details data-menu="nav"> whose panel spans
// the header's full width (the sticky header is its positioned parent) and scrolls inside itself
// when it is taller than the screen (140px: the header and, on staging, the demo banner). MenuCloser (root layout) closes it after a tap on one of its
// links or buttons, or outside it. `className` says from which width it hides (lg:hidden, ...).
export function PhoneMenu({ className, children }: { className: string; children: ReactNode }) {
  return (
    <details data-menu="nav" className={`group ${className}`}>
      <summary
        aria-label="Menu"
        className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg border border-[#dce6e0] bg-white text-brand hover:bg-brand-soft [&::-webkit-details-marker]:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 group-open:hidden" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" />
        </svg>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="hidden h-5 w-5 group-open:block" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </summary>
      <div className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-140px)] overflow-y-auto border-b border-line bg-white px-5 pb-6 pt-2 shadow-[0_18px_38px_rgba(19,47,39,0.14)]">
        {children}
      </div>
    </details>
  );
}

export function PhoneMenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border-b border-[#eeeae5] py-2 last:border-b-0">
      {title ? <p className="px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted">{title}</p> : null}
      {children}
    </div>
  );
}

// A link or button row in the panel: a 48px tap target.
export const phoneMenuItem =
  "flex min-h-12 w-full items-center rounded-lg px-3 text-left text-[15px] font-semibold text-ink hover:bg-brand-soft hover:text-brand aria-[current=page]:bg-brand-soft aria-[current=page]:text-brand";
