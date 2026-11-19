import { describe, expect, it } from "vitest";
import { menusToClose, type MenuLike } from "./menu-rules";

// A fake menu: `inside` lists the targets that are inside it.
function menu(kind: "plain" | "nav", inside: string[], open = true): MenuLike & { name: string } {
  return { name: `${kind}:${inside.join(",")}`, open, kind, contains: (node: unknown) => inside.includes(node as string) };
}

describe("menusToClose (plan 9: a tap outside closes an open menu)", () => {
  it("a tap outside every menu closes the open ones", () => {
    const a = menu("plain", ["a-1"]);
    const b = menu("nav", ["b-1"]);
    expect(menusToClose([a, b], "page", "pointer", false)).toEqual([a, b]);
  });

  it("a tap inside a menu keeps it open and closes the others", () => {
    const a = menu("plain", ["a-1"]);
    const b = menu("nav", ["b-1"]);
    expect(menusToClose([a, b], "a-1", "pointer", false)).toEqual([b]);
  });

  it("closed menus are left alone", () => {
    expect(menusToClose([menu("plain", ["a-1"], false)], "page", "pointer", false)).toEqual([]);
  });

  it("using a link or button inside a nav menu closes it", () => {
    const nav = menu("nav", ["link"]);
    expect(menusToClose([nav], "link", "click", true)).toEqual([nav]);
  });

  it("a click on a plain menu's own controls (a select, a remove button) keeps it open", () => {
    const guests = menu("plain", ["remove-child"]);
    expect(menusToClose([guests], "remove-child", "click", true)).toEqual([]);
  });

  it("a click on a nav menu's empty space keeps it open", () => {
    const nav = menu("nav", ["panel"]);
    expect(menusToClose([nav], "panel", "click", false)).toEqual([]);
  });
});
