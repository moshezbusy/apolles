"use client";

import { useEffect, useId, useRef, useState } from "react";
import { input } from "@/components/ui";

// "Destination or hotel" box (screen 07): type two letters, pick a city or area from the list.
// Only a destination picked from the list is sent (its id, in a hidden field); free text is
// not a destination. Keyboard: arrows move, Enter picks, Escape closes.

type Destination = { id: string; label: string; type: string };

export function DestinationPicker({ defaultId, defaultLabel }: { defaultId: string; defaultLabel: string }) {
  const [text, setText] = useState(defaultLabel);
  const [chosen, setChosen] = useState(defaultId ? { id: defaultId, label: defaultLabel } : null);
  const [options, setOptions] = useState<Destination[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
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
        if (!response.ok) return;
        const body = (await response.json()) as { destinations?: Destination[] };
        setOptions(Array.isArray(body.destinations) ? body.destinations : []);
        setActive(-1);
        setOpen(true);
      } catch {
        // aborted or offline: keep the old list
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text, chosen]);

  function pick(option: Destination): void {
    setChosen({ id: option.id, label: option.label });
    setText(option.label);
    setOpen(false);
  }

  const searching = !(chosen?.label === text || text.trim().length < 2);
  const showList = open && searching && options.length > 0;

  return (
    <div className="relative">
      <input type="hidden" name="destinationId" value={chosen?.id ?? ""} />
      <input type="hidden" name="destinationLabel" value={text} />
      <input
        type="text"
        role="combobox"
        aria-label="Destination"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        maxLength={60}
        placeholder="City or area"
        value={text}
        className={input}
        onChange={(event) => {
          setText(event.target.value);
          if (chosen && event.target.value !== chosen.label) setChosen(null);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!showList) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            const option = options[active];
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
              key={option.id}
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
              <span className="ml-2 text-[11px] text-muted">{option.type === "city" ? "City" : "Area"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
