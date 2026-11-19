"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { input, label as labelClass } from "@/components/ui";
import { Calendar } from "./MonthCalendar";
import { formatDmy, isIsoDate, isSelectable, monthOf, type Month } from "./calendar";
import { useDismiss, useKeepInView } from "./use-dismiss";

// One date (plan 9): the whole field is a button that opens our calendar; the date shows as
// DD/MM/YYYY and is sent as ISO YYYY-MM-DD in a hidden input, as the native date input did, so
// the server reads the same value. The server still checks every date.

export function DateField({
  name,
  label,
  defaultValue = "",
  min = "",
  max = "",
  today = "",
  onChange,
  hint,
}: {
  name: string;
  label: ReactNode;
  defaultValue?: string;
  min?: string;
  max?: string;
  today?: string;
  onChange?: (iso: string) => void;
  hint?: ReactNode;
}) {
  const [value, setValue] = useState(isIsoDate(defaultValue) ? defaultValue : "");
  const [open, setOpen] = useState(false);
  // Where the calendar opens: the chosen date, else today, else the first allowed date.
  const start = value || today || min || new Date().toISOString().slice(0, 10);
  const [view, setView] = useState<Month>(() => monthOf(start) ?? { year: 2026, month: 0 });
  const [focusDay, setFocusDay] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback((reason: "outside" | "escape" | "picked") => {
    setOpen(false);
    if (reason !== "outside") trigger.current?.focus();
  }, []);
  useDismiss(box, open, close);
  useKeepInView(pop, open);

  function toggle() {
    if (!open) {
      const at = value || start;
      setView(monthOf(at) ?? view);
      setFocusDay(at);
    }
    setOpen(!open);
  }

  return (
    <div ref={box} className="relative">
      <label className={labelClass}>
        <span id={`${id}-label`}>{label}</span>
        <input type="hidden" name={name} value={value} />
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}-value`}
          onClick={toggle}
          className={`${input} flex items-center justify-between gap-2 text-left`}
        >
          <DateText id={`${id}-value`} value={value} />
          <CalendarIcon />
        </button>
      </label>
      {hint}
      {open ? (
        <div ref={pop} role="dialog" aria-label="Choose a date" className="absolute left-0 top-full z-50 mt-1.5 w-[min(320px,calc(100vw-16px))]">
          <Calendar
            label="Choose a date"
            view={view}
            onView={setView}
            months={1}
            isDisabled={(day) => !isSelectable(day, min, max)}
            selected={value ? [value] : []}
            today={today}
            focusDay={focusDay}
            onFocusDay={setFocusDay}
            onPick={(day) => {
              setValue(day);
              onChange?.(day);
              close("picked");
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// The field's date, DD/MM/YYYY; empty, a grey "DD/MM/YYYY" that screen readers hear as "not chosen".
export function DateText({ id, value }: { id: string; value: string }) {
  return value ? (
    <span id={id} className="tabular-nums">
      {formatDmy(value)}
    </span>
  ) : (
    <span id={id} className="text-[#9ba29e]">
      <span aria-hidden="true">DD/MM/YYYY</span>
      <span className="sr-only">not chosen</span>
    </span>
  );
}

export function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" />
    </svg>
  );
}
