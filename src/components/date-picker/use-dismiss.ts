"use client";

import { useEffect, type RefObject } from "react";

// Closes a popover on a tap outside `ref` and on Escape (plan 9), while it is open.
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: (reason: "outside" | "escape") => void): void {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close("outside");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close("escape");
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}
