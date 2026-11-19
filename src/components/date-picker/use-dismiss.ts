"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

// Closes a popover on a tap outside `ref`, when focus leaves it (Tab), and on Escape (plan 9),
// while it is open.
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: (reason: "outside" | "escape") => void): void {
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => target instanceof Node && !ref.current?.contains(target);
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target)) close("outside");
    };
    const onFocus = (event: FocusEvent) => {
      if (outside(event.target)) close("outside");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close("escape");
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

// Shifts an open popover sideways so it stays on the screen (a field on the right half of a
// phone screen would push it past the edge and widen the page). 8px from each edge.
export function useKeepInView(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.transform = "";
    const rect = el.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.right > width - 8) shift = width - 8 - rect.right;
    if (rect.left + shift < 8) shift = 8 - rect.left;
    if (shift !== 0) el.style.transform = `translateX(${Math.round(shift)}px)`;
  }, [ref, open]);
}
