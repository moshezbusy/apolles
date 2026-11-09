// Shared class strings for the mockup design (Apolles-Mockups.zip). One place, so every page
// draws buttons, inputs, cards, alerts and tables the same way. Colours come from the theme
// tokens in src/app/globals.css.

export const btnPrimary =
  "inline-flex min-h-[42px] items-center justify-center rounded-lg bg-brand px-4 text-sm font-bold text-paper hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60";

export const btnSecondary =
  "inline-flex min-h-[42px] items-center justify-center rounded-lg border border-[#d9e1dc] bg-white px-4 text-sm font-bold text-brand hover:border-[#bcd0c6] hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60";

export const btnDanger =
  "inline-flex min-h-[42px] items-center justify-center rounded-lg bg-[#8a3f32] px-4 text-sm font-bold text-paper hover:bg-[#74342a] disabled:cursor-not-allowed disabled:opacity-60";

export const link = "text-sm font-semibold text-brand hover:underline disabled:opacity-60";

export const label = "flex flex-col gap-1.5 text-xs font-semibold text-[#37413d]";

// Focus: a solid brand-green border and ring, clearly visible for keyboard users (WCAG 2.4.7).
// Size and weight are not in the base, so the code input can set its own without a conflict.
const inputBase =
  "min-h-10 w-full rounded-lg border border-[#d9e1dc] bg-paper px-3 py-2 text-ink placeholder:text-[#9ba29e] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/40";
export const input = `${inputBase} text-sm font-normal`;
// The 6-digit 2FA code field: large, bold, spaced digits.
export const codeInput = `${inputBase} text-center text-xl font-bold tracking-[0.4em]`;

export const hint = "text-xs text-muted";

export const card =
  "rounded-[18px] border border-[#ece7de] bg-paper shadow-[0_8px_24px_rgba(23,63,53,0.06)]";

const alertBase = "rounded-[9px] border px-3 py-2.5 text-[13px] leading-normal";
export const alertError = `${alertBase} border-[#edd9d4] bg-[#fbf4f2] text-[#8a3f32]`;
export const alertInfo = `${alertBase} border-[#eadfbe] bg-[#fff9e9] text-[#6f5a20]`;
export const alertSuccess = `${alertBase} border-[#d3e3da] bg-brand-soft text-brand`;

export const pageTitle = "font-serif text-[34px] font-medium leading-tight tracking-tight text-ink";
export const sectionTitle = "text-base font-bold text-ink";
export const eyebrow = "text-xs font-extrabold uppercase tracking-[0.16em] text-brand-2";

// Tables (mockup 13, Bookings): white rounded card, small uppercase headers, dark cell text.
export const tableWrap =
  "overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_14px_36px_rgba(19,47,39,0.08)]";
export const table = "w-full text-left text-sm";
export const thead = "border-b border-line";
export const th = "px-4 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5f6863]";
// `cell` has no colour: use it when a cell sets its own (two colour classes on one element
// conflict, and the winner depends on CSS order, not class order). `td` is the dark default.
export const cell = "px-4 py-3.5 align-middle";
export const td = `${cell} text-ink`;
export const tbody = "divide-y divide-[#f0ece4]";

// Status pills (mockup 13): a dot and a soft background.
const pillBase = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold";
export const pillGreen = `${pillBase} bg-brand-soft text-brand`;
export const pillRed = `${pillBase} bg-[#fbecea] text-[#9b3b2e]`;
export const pillDot = "h-1.5 w-1.5 rounded-full bg-current";

export const emptyState = `${card} p-6 text-sm text-muted`;
