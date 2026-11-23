"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Which part of the agent header the open page belongs to (mockups 07 to 19): the booking flow
// (search, guest details, review) is Search; clients are under Quotes; the balance is under
// Reporting. Read from the browser's path, so it follows every navigation (the header itself is
// drawn once by the layout).
export type NavSectionId = "search" | "quotes" | "bookings" | "reporting";

export function sectionOf(path: string | null): NavSectionId | null {
  if (!path) return null;
  const top = `/${path.split("/")[1] ?? ""}`;
  if (top === "/search" || top === "/book") return "search";
  if (top === "/quotes" || top === "/clients") return "quotes";
  if (top === "/bookings") return "bookings";
  if (top === "/reporting" || top === "/balance") return "reporting";
  return null;
}

// The open section: brand green, bold, underlined (mockup 07, .nav-link.active).
const ACTIVE = "font-bold text-brand underline decoration-2 underline-offset-[10px]";

// A top-level header link (Search) that is marked while its section is open.
export function SectionLink({ section, href, className, children }: { section: NavSectionId; href: string; className: string; children: ReactNode }) {
  const active = sectionOf(usePathname()) === section;
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${className} ${active ? ACTIVE : ""}`}>
      {children}
    </Link>
  );
}

// The label of a header menu (Quotes, Bookings, Reporting), marked while its section is open.
export function SectionLabel({ section, children }: { section: NavSectionId; children: ReactNode }) {
  const active = sectionOf(usePathname()) === section;
  return <span className={active ? ACTIVE : undefined}>{children}</span>;
}

// A link in a menu or the phone menu: marked (aria-current) when it is the page that is open.
export function MenuLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const current = usePathname() === href;
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
