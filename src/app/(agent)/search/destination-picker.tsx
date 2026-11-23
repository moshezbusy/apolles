"use client";

import { useEffect, useId, useRef, useState } from "react";
import { input } from "@/components/ui";

// Destination box (screen 07: "City, hotel or location"): type two letters for cities and areas,
// three for hotels by name too (with their city and country). Only a choice from the list is
// sent, in a hidden field: a destination's id (destinationId) or a hotel's id (propertyId); free
// text is neither. A hotel searches that one hotel. Keyboard: arrows move, Enter picks (the first
// one when none is highlighted), Escape closes. A text with no match says so; so does the
// server's "too many requests" (instead of an empty list that looks like "nothing found").

export type Choice = { kind: "destination"; id: string; label: string; type: string } | { kind: "hotel"; id: string; label: string; place: string };

type Answer = { destinations?: { id: string; label: string; type: string }[]; hotels?: { id: string; name: string; place: string }[] };

// The server's answer as one list: destinations first, then hotels. Anything malformed is left out.
export function choicesOf(body: Answer): Choice[] {
  const text = (v: unknown): v is string => typeof v === "string";
  const destinations = Array.isArray(body.destinations) ? body.destinations : [];
  const hotels = Array.isArray(body.hotels) ? body.hotels : [];
  return [
    ...destinations.filter((d) => d && text(d.id) && text(d.label)).map((d) => ({ kind: "destination" as const, id: d.id, label: d.label, type: String(d.type) })),
    ...hotels.filter((h) => h && text(h.id) && text(h.name)).map((h) => ({ kind: "hotel" as const, id: h.id, label: h.name, place: text(h.place) ? h.place : "" })),
  ];
}

export function enterChoice(options: Choice[], active: number): Choice | null {
  return options[active >= 0 ? active : 0] ?? null;
}

export function noMatchText(typed: string): string {
  return `No city, area or hotel matches "${typed}". Check the spelling, or type the city the hotel is in.`;
}

// What the list shows next to a choice's name.
export function choiceDetail(choice: Choice): string {
  if (choice.kind === "hotel") return choice.place ? `Hotel · ${choice.place}` : "Hotel";
  return choice.type === "city" ? "City" : "Area";
}

export const TOO_MANY_TEXT = "Too many searches. Wait a moment, then type again.";
export const DESTINATION_PLACEHOLDER = "City, hotel or location";

export function DestinationPicker({ defaultId, defaultLabel, defaultPropertyId = "" }: { defaultId: string; defaultLabel: string; defaultPropertyId?: string }) {
  const [text, setText] = useState(defaultLabel);
  const [chosen, setChosen] = useState<{ kind: Choice["kind"]; id: string; label: string } | null>(
    defaultPropertyId ? { kind: "hotel", id: defaultPropertyId, label: defaultLabel } : defaultId ? { kind: "destination", id: defaultId, label: defaultLabel } : null,
  );
  const [options, setOptions] = useState<Choice[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The text the shown list (or "no match") answers, so an old answer is never shown as current.
  const [answered, setAnswered] = useState("");
  // The text for which the server said "too many requests" (HTTP 429).
  const [limitedFor, setLimitedFor] = useState<string | null>(null);
  const listId = useId();
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = text.trim();
    if (chosen?.label === text || q.length < 2) return;
    const timer = setTimeout(async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const response = await fetch(`/search/destinations?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (response.status === 429) {
          setLimitedFor(q);
          setOpen(true);
          return;
        }
        if (!response.ok) return;
        setOptions(choicesOf((await response.json()) as Answer));
        setAnswered(q);
        setLimitedFor(null);
        setActive(-1);
        setOpen(true);
      } catch {
        // aborted or offline: keep the old list
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text, chosen]);

  function pick(option: Choice): void {
    setChosen({ kind: option.kind, id: option.id, label: option.label });
    setText(option.label);
    setOpen(false);
  }

  const searching = !(chosen?.label === text || text.trim().length < 2);
  const showLimited = open && searching && limitedFor === text.trim();
  const showList = open && searching && !showLimited && options.length > 0;
  const showNoMatch = open && searching && !showLimited && options.length === 0 && answered === text.trim();

  return (
    <div className="relative">
      <input type="hidden" name="destinationId" value={chosen?.kind === "destination" ? chosen.id : ""} />
      <input type="hidden" name="propertyId" value={chosen?.kind === "hotel" ? chosen.id : ""} />
      <input type="hidden" name="destinationLabel" value={text} />
      <input
        type="text"
        role="combobox"
        aria-label="Destination or hotel"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        maxLength={60}
        placeholder={DESTINATION_PLACEHOLDER}
        value={text}
        className={input}
        onChange={(event) => {
          setText(event.target.value);
          if (chosen && event.target.value !== chosen.label) setChosen(null);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!showList) {
            if (event.key === "Escape") setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const option = enterChoice(options, active);
            if (option) pick(option);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1.5 max-h-72 overflow-auto rounded-[11px] border border-[#e1e6e3] bg-white p-1.5 shadow-[0_15px_38px_rgba(19,47,39,0.14)]"
        >
          {options.map((option, index) => (
            <li
              key={`${option.kind}-${option.id}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`cursor-pointer rounded-[7px] px-2.5 py-2 text-[13px] ${index === active ? "bg-[#f1f6f3] text-brand" : "text-ink"}`}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
            >
              {option.label}
              <span className="ml-2 text-[11px] text-muted">{choiceDetail(option)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {showNoMatch || showLimited ? (
        <p
          role="status"
          className="absolute left-0 right-0 z-40 mt-1.5 rounded-[11px] border border-[#e1e6e3] bg-white px-4 py-3 text-[13px] text-muted shadow-[0_15px_38px_rgba(19,47,39,0.14)]"
        >
          {showLimited ? TOO_MANY_TEXT : noMatchText(text.trim())}
        </p>
      ) : null}
    </div>
  );
}
