"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { input, label as labelClass } from "@/components/ui";
import { CalendarIcon, DateText } from "./DateField";
import { Calendar } from "./MonthCalendar";
import { MAX_NIGHTS, checkoutLimits, isIsoDate, isSelectable, monthOf, nightsBetween, type Month } from "./calendar";
import { useDismiss, useKeepInView } from "./use-dismiss";

// Check-in and check-out in one calendar (plan 9): a tap on either field opens it; the first
// tap picks check-in, the second check-out, and the nights between are shaded. Check-out is 1
// to 28 nights after check-in (the server's limit). A tap before check-in while choosing
// check-out starts again from that day. Two months side by side from md, one on a phone.
// Both dates are sent as ISO in hidden inputs; the server checks them again.

type Picking = "checkin" | "checkout";

export function DateRangeField({
  checkin: initialCheckin,
  checkout: initialCheckout,
  min,
  max,
  checkinName = "checkin",
  checkoutName = "checkout",
}: {
  checkin: string;
  checkout: string;
  min: string;
  max: string;
  checkinName?: string;
  checkoutName?: string;
}) {
  const startIn = isIsoDate(initialCheckin) ? initialCheckin : "";
  const [checkin, setCheckin] = useState(startIn);
  const [checkout, setCheckout] = useState(startIn && nightsBetween(startIn, initialCheckout) !== null ? initialCheckout : "");
  // `anchor`: the field the calendar opened under (it stays there); `open`: what a tap picks.
  const [anchor, setAnchor] = useState<Picking | null>(null);
  const [picking, setPicking] = useState<Picking>("checkin");
  const open = anchor === null ? null : picking;
  const [view, setView] = useState<Month>(() => monthOf(startIn || min) ?? { year: 2026, month: 0 });
  const [focusDay, setFocusDay] = useState(startIn || min);
  const box = useRef<HTMLDivElement>(null);
  const triggers = { checkin: useRef<HTMLButtonElement>(null), checkout: useRef<HTMLButtonElement>(null) };
  const stay = nightsBetween(checkin, checkout);

  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  // Focus goes back to the field the calendar opened under (Escape) or to check-out (picked).
  const anchorRef = useRef<Picking | null>(null);
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);
  const close = useCallback((reason: "outside" | "escape" | "picked") => {
    const field = reason === "escape" ? (anchorRef.current ?? "checkin") : "checkout";
    setAnchor(null);
    if (reason !== "outside") triggers[field].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs are stable
  }, []);
  useDismiss(box, anchor !== null, close);
  useKeepInView(pop, anchor !== null);

  function show(field: Picking) {
    if (anchor === field) return setAnchor(null);
    const mode: Picking = field === "checkout" && !checkin ? "checkin" : field;
    const at = (mode === "checkout" ? checkout || checkin : checkin) || min;
    setView(monthOf(at) ?? view);
    setFocusDay(at);
    setPicking(mode);
    setAnchor(field);
  }

  function disabled(day: string): boolean {
    if (!isSelectable(day, min, max)) return true;
    if (open !== "checkout" || !checkin || day <= checkin) return false;
    return !isSelectable(day, ...limits(checkin, max));
  }

  function pick(day: string) {
    if (open === "checkout" && checkin && day > checkin) {
      setCheckout(day);
      close("picked");
      return;
    }
    setCheckin(day);
    const nights = nightsBetween(day, checkout);
    if (nights === null || nights > MAX_NIGHTS) setCheckout("");
    setPicking("checkout");
  }

  const popover = (which: Picking) =>
    anchor === which ? (
      <div
        ref={pop}
        role="dialog"
        aria-label={picking === "checkin" ? "Choose check-in" : "Choose check-out"}
        className={`absolute left-0 top-full z-50 mt-1.5 w-full max-w-[min(340px,calc(100vw-16px))] md:w-auto md:max-w-none ${which === "checkout" ? "md:left-auto md:right-0" : ""}`}
      >
        <p className="sr-only" aria-live="polite">
          {picking === "checkin" ? "Choose the check-in date" : "Choose the check-out date"}
        </p>
        <Calendar
          label={picking === "checkin" ? "Check-in date" : "Check-out date"}
          view={view}
          onView={setView}
          months={2}
          isDisabled={disabled}
          selected={[checkin, checkout].filter(Boolean)}
          rangeStart={checkin}
          rangeEnd={checkout}
          today={min}
          focusDay={focusDay}
          onFocusDay={setFocusDay}
          onPick={pick}
        />
      </div>
    ) : null;

  // On a phone the two fields sit side by side and the calendar opens below both (the outer
  // box is its anchor); from md each field is its own grid cell (md:contents) and the calendar
  // opens below the field that was tapped.
  const field = (which: Picking, value: string, text: React.ReactNode) => (
    <div className="md:relative">
      <label className={labelClass}>
        <span id={`${id}-${which}-label`}>{text}</span>
        <input type="hidden" name={which === "checkin" ? checkinName : checkoutName} value={value} />
        <button
          ref={triggers[which]}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={anchor === which}
          aria-labelledby={`${id}-${which}-label ${id}-${which}-value`}
          onClick={() => show(which)}
          className={`${input} flex items-center justify-between gap-2 text-left ${open === which ? "border-brand ring-2 ring-brand/40" : ""}`}
        >
          <DateText id={`${id}-${which}-value`} value={value} />
          <CalendarIcon />
        </button>
      </label>
      {popover(which)}
    </div>
  );

  return (
    <div ref={box} className="relative grid grid-cols-2 gap-3 md:contents">
      {field("checkin", checkin, "Check-in")}
      {field(
        "checkout",
        checkout,
        <>
          Check-out {stay ? <span className="font-normal text-muted">· {stay} {stay === 1 ? "night" : "nights"}</span> : null}
        </>,
      )}
    </div>
  );
}

function limits(checkin: string, max: string): [string, string] {
  const { min, max: last } = checkoutLimits(checkin, max);
  return [min, last];
}
