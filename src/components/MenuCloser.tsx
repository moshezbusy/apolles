"use client";

import { useEffect } from "react";
import { menusToClose } from "./menu-rules";

// Mounted once in the root layout (plan 9). Closes an open <details data-menu> on a tap
// outside it and on Escape, and a data-menu="nav" menu when a link or button in it is used.
// Renders nothing.
export function MenuCloser() {
  useEffect(() => {
    const openMenus = () =>
      [...document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")].map((el) => ({
        el,
        open: el.open,
        kind: el.dataset.menu === "nav" ? ("nav" as const) : ("plain" as const),
        contains: (node: unknown) => node instanceof Node && el.contains(node),
      }));
    const close = (menus: { el: HTMLDetailsElement }[]) => {
      for (const menu of menus) menu.el.open = false;
    };
    const isAction = (target: EventTarget | null) =>
      target instanceof Element && target.closest("a[href], button, [role='menuitem']") !== null && target.closest("summary") === null;

    const onPointer = (event: PointerEvent) => close(menusToClose(openMenus(), event.target, "pointer", false));
    const onClick = (event: MouseEvent) => close(menusToClose(openMenus(), event.target, "click", isAction(event.target)));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const menus = openMenus();
      if (menus.length === 0) return;
      close(menus);
      menus[menus.length - 1]?.el.querySelector("summary")?.focus();
    };

    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
