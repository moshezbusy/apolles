// Which open menus close after a tap (plan 9). A menu is a <details data-menu>:
// - "plain" (a dropdown with its own controls, such as rooms and guests): closes on a tap outside;
// - "nav" (a list of links, such as the header menus): also closes when one of its links or
//   buttons is used, so the panel does not stay open over the next page.
export type MenuLike = { open: boolean; kind: "plain" | "nav"; contains(node: unknown): boolean };

export function menusToClose<M extends MenuLike>(menus: M[], target: unknown, event: "pointer" | "click", isAction: boolean): M[] {
  return menus.filter((menu) => {
    if (!menu.open) return false;
    const inside = menu.contains(target);
    if (event === "pointer") return !inside;
    return inside && isAction && menu.kind === "nav";
  });
}
