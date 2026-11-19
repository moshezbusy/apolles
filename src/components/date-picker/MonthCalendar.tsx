"use client";

import { useEffect, useRef } from "react";
import { addDays, monthGrid, monthLabel, monthOf, shiftMonth, type Month } from "./calendar";

// The month grid of the date fields (plan 9), in the system's colours. One month on a phone,
// two side by side from md when `months` is 2. Keyboard: arrows move a day or a week, Page Up /
// Page Down a month, Enter or Space picks, Escape closes (the field handles Escape).

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export type CalendarProps = {
  view: Month;
  onView: (month: Month) => void;
  months: 1 | 2;
  isDisabled: (day: string) => boolean;
  selected: string[];
  rangeStart?: string;
  rangeEnd?: string;
  today: string;
  focusDay: string;
  onFocusDay: (day: string) => void;
  onPick: (day: string) => void;
  label: string;
};

export function Calendar(props: CalendarProps) {
  const { view, onView, months, focusDay, onFocusDay, label } = props;
  const root = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // Focus the focused day when the calendar opens and after each keyboard move.
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>(`button[data-day="${focusDay}"]`)?.focus({ preventScroll: !moved.current });
    moved.current = false;
  }, [focusDay, view]);

  function move(day: string) {
    if (day === "") return;
    const month = monthOf(day);
    if (month) {
      // Keep the focused day on screen: before the shown months it becomes the first, after
      // them the last.
      const at = index(month) - index(view);
      if (at < 0) onView(month);
      else if (at >= months) onView(shiftMonth(month, 1 - months));
    }
    moved.current = true;
    onFocusDay(day);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in by) {
      event.preventDefault();
      move(addDays(focusDay, by[event.key]!));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const target = shiftMonth(monthOf(focusDay) ?? view, event.key === "PageUp" ? -1 : 1);
      const day = Math.min(Number(focusDay.slice(8, 10)) || 1, daysIn(target));
      move(`${target.year}-${String(target.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }

  return (
    <div ref={root} role="group" aria-label={label} onKeyDown={onKeyDown} className="rounded-[14px] border border-[#e1e6e3] bg-white p-3 shadow-[0_18px_42px_rgba(19,47,39,0.16)]">
      <div className="flex gap-6">
        {/* With two months, the first one's "next" arrow shows only on a phone, where the
            second month is hidden. */}
        <MonthTable {...props} month={view} prev={() => onView(shiftMonth(view, -1))} next={() => onView(shiftMonth(view, 1))} nextClassName={months === 2 ? "md:invisible" : ""} />
        {months === 2 ? (
          <div className="hidden md:block">
            <MonthTable {...props} month={shiftMonth(view, 1)} next={() => onView(shiftMonth(view, 1))} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const navButton = "grid h-9 w-9 place-items-center rounded-full text-lg text-brand hover:bg-brand-soft";

function index({ year, month }: Month): number {
  return year * 12 + month;
}

function daysIn({ year, month }: Month): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function MonthTable({
  month,
  prev,
  next,
  isDisabled,
  selected,
  rangeStart,
  rangeEnd,
  today,
  focusDay,
  onPick,
  nextClassName = "",
}: CalendarProps & { month: Month; prev?: (() => void) | undefined; next?: (() => void) | undefined; nextClassName?: string }) {
  const title = monthLabel(month.year, month.month);
  return (
    <div className="w-full min-w-[266px]">
      <div className="mb-2 flex h-9 items-center justify-between">
        {prev ? (
          <button type="button" onClick={prev} className={navButton} aria-label="Previous month">
            ‹
          </button>
        ) : (
          <span className="w-9" />
        )}
        <p className="text-sm font-bold text-ink" aria-live="polite">
          {title}
        </p>
        {next ? (
          <button type="button" onClick={next} className={`${navButton} ${nextClassName}`} aria-label="Next month">
            ›
          </button>
        ) : (
          <span className="w-9" />
        )}
      </div>
      <table className="w-full border-collapse" role="grid" aria-label={title}>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month.year, month.month).map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (!day) return <td key={j} className="h-10 p-0" />;
                const disabled = isDisabled(day);
                const isSelected = selected.includes(day);
                const between = rangeStart && rangeEnd && day > rangeStart && day < rangeEnd;
                return (
                  <td key={j} className={`h-10 p-0 text-center ${between ? "bg-brand-soft" : ""}`}>
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focusDay ? 0 : -1}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      aria-label={longDate(day)}
                      onClick={() => onPick(day)}
                      className={`mx-auto grid h-10 w-10 place-items-center rounded-full text-sm tabular-nums outline-none transition focus-visible:ring-2 focus-visible:ring-brand/50 ${
                        isSelected
                          ? "bg-brand font-bold text-paper"
                          : disabled
                            ? "cursor-not-allowed text-[#c3c9c5]"
                            : `text-ink hover:bg-[#e3ece7] ${day === today ? "font-bold text-brand underline decoration-2 underline-offset-4" : ""}`
                      }`}
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const longFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function longDate(day: string): string {
  return longFormat.format(new Date(`${day}T00:00:00Z`));
}
