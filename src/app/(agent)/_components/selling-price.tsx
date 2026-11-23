"use client";

import { useActionState, useState } from "react";
import { alertError, alertSuccess, btnSecondary, input } from "@/components/ui";
import { formatUsd } from "@/lib/money";

type State = { status: "success" | "error"; message: string } | null;
type Action = (previous: State, formData: FormData) => Promise<State>;

// Same rounding as the server (sellingMinor): percent in basis points, rounded half up once.
function preview(netMinor: number, type: string, raw: string): { sale: number; profit: number } | null {
  const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(raw.trim() === "" ? "0" : raw.trim());
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (type === "FIXED") return hundredths <= 1_000_000 ? { sale: netMinor + hundredths, profit: hundredths } : null;
  if (hundredths > 10_000) return null;
  const profit = Math.floor((netMinor * hundredths + 5_000) / 10_000);
  return { sale: netMinor + profit, profit };
}

// "Add your selling price (optional)" / "Your selling price" (screens 11, 12). For the agency's
// reports only: it does not change the amount deducted and is not on the voucher. `suggested`:
// the agency's default markup (Agency settings), filled in when nothing is saved yet; it is
// saved only when the agent chooses "Save selling price".
export function SellingPrice({
  action,
  bookingId,
  netMinor,
  saved,
  suggested,
  title,
}: {
  action: Action;
  bookingId: string;
  netMinor: number;
  saved: { markupType: "PERCENT" | "FIXED"; markupValue: number } | null;
  suggested?: { markupType: "PERCENT" | "FIXED"; markupValue: number } | null;
  title: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, null);
  const start = saved ?? (suggested && suggested.markupValue > 0 ? suggested : null);
  const [type, setType] = useState<string>(start?.markupType ?? "PERCENT");
  const [value, setValue] = useState(start ? String(start.markupValue / 100) : "");
  const shown = preview(netMinor, type, value);
  return (
    <form action={formAction} className="flex flex-col gap-2" noValidate>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <select name="markupType" value={type} onChange={(e) => setType(e.target.value)} aria-label="Markup type" className={input}>
          <option value="FIXED">Fixed (USD)</option>
          <option value="PERCENT">Percentage (%)</option>
        </select>
        <input name="markupValue" inputMode="decimal" maxLength={12} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Markup value" placeholder="0" className={input} />
      </div>
      <p className="flex justify-between text-[13px] text-[#37413d]">
        <span>Selling price · your profit</span>
        <strong className="tabular-nums text-ink">{shown ? `${formatUsd(shown.sale)} · ${formatUsd(shown.profit)}` : "Check the markup"}</strong>
      </p>
      {!saved && start ? <p className="text-xs text-muted">Your default markup from Agency settings. Save it to use it for this booking.</p> : null}
      <p className="text-xs text-muted">For your reports only. It is not shown on the voucher and does not change the amount deducted.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnSecondary}>
          {pending ? "Saving…" : "Save selling price"}
        </button>
        {saved ? (
          <button type="submit" name="clear" value="1" disabled={pending} className="text-sm font-semibold text-muted hover:text-ink">
            Remove
          </button>
        ) : null}
      </div>
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
