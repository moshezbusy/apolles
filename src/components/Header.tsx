import Link from "next/link";
import { createQuoteAction } from "@/app/(agent)/quotes/actions";
import { MenuLink, SectionLabel, SectionLink, type NavSectionId } from "@/components/NavSection";
import { PhoneMenu, PhoneMenuSection, phoneMenuItem } from "@/components/PhoneMenu";
import { SignOutButton } from "@/components/SignOutButton";
import { formatUsd } from "@/lib/money";

// Agent header (mockup 07). Quotes (All quotes, New quote, Clients), Bookings (All, Upcoming
// stays, Completed, Cancelled) and Reporting (Overview, Balance history) are menus: plain <details> elements, so they need no client JavaScript.
// Below lg the menus do not fit: a "Menu" button opens one panel with all of them, the agency's
// settings and Sign out (plan 9). data-menu: MenuCloser closes an open menu on a tap outside.
// The section of the open page is marked (NavSection.tsx), in the bar and in the phone menu.

const BOOKINGS = [
  { href: "/bookings", label: "All bookings" },
  { href: "/bookings?tab=upcoming", label: "Upcoming stays" },
  { href: "/bookings?tab=completed", label: "Completed" },
  { href: "/bookings?tab=cancelled", label: "Cancelled" },
] as const;

const REPORTING = [
  { href: "/reporting", label: "Overview" },
  { href: "/balance", label: "Balance history" },
] as const;

const dropdown =
  "absolute left-0 z-40 mt-2.5 flex w-[170px] flex-col rounded-[11px] border border-[#e1e6e3] bg-white p-[7px] shadow-[0_15px_38px_rgba(19,47,39,0.14)]";
const dropdownItem = "rounded-[7px] px-2.5 py-2 text-left text-[12.5px] text-[#4d5a54] hover:bg-[#f1f6f3] hover:text-brand";
const menuSummary = "flex cursor-pointer list-none items-center gap-1 font-semibold text-[#4d5a54] hover:text-brand";

// "Test Travel" → "TT", "Caryotrip" → "CA". Shown in the avatar circle.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

function DesktopMenu({ label, section, children }: { label: string; section: NavSectionId; children: React.ReactNode }) {
  return (
    <details data-menu="nav" className="relative">
      <summary className={menuSummary}>
        <SectionLabel section={section}>{label}</SectionLabel> <span aria-hidden="true" className="text-[11px] text-[#8a938e]">▾</span>
      </summary>
      <div className={dropdown}>{children}</div>
    </details>
  );
}

export function Header({ agencyName, balanceCents }: { agencyName: string; balanceCents: number }) {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line bg-white">
      <div className="mx-auto flex h-full w-[min(1260px,calc(100%-40px))] items-center gap-4 sm:gap-7">
        <Link href="/search" className="font-serif text-[22px] text-ink sm:text-[27px]">
          Apolles
        </Link>

        <nav aria-label="Main" className="hidden h-full items-center gap-6 text-[13px] lg:flex">
          <SectionLink section="search" href="/search" className="flex h-full items-center font-semibold text-[#4d5a54] hover:text-brand">
            Search
          </SectionLink>
          <DesktopMenu label="Quotes" section="quotes">
            <Link href="/quotes" className={dropdownItem}>
              All quotes
            </Link>
            <form action={createQuoteAction}>
              <button type="submit" className={`w-full ${dropdownItem}`}>
                New quote
              </button>
            </form>
            <Link href="/clients" className={dropdownItem}>
              Clients
            </Link>
          </DesktopMenu>
          <DesktopMenu label="Bookings" section="bookings">
            {BOOKINGS.map((item) => (
              <Link key={item.href} href={item.href} className={dropdownItem}>
                {item.label}
              </Link>
            ))}
          </DesktopMenu>
          <DesktopMenu label="Reporting" section="reporting">
            {REPORTING.map((item) => (
              <Link key={item.href} href={item.href} className={dropdownItem}>
                {item.label}
              </Link>
            ))}
          </DesktopMenu>
        </nav>

        <div className="ml-auto flex items-center gap-2.5 sm:gap-3.5">
          {/* The amount is the link's first text (screen readers say it first); the small
              "Balance" label is drawn above it with flex-col-reverse, as in the mockup. */}
          <Link
            href="/balance"
            className="flex flex-col-reverse items-end rounded-[10px] border border-[#dce6e0] bg-[#f7faf8] px-[11px] py-1.5 text-[12.5px] font-bold leading-tight tabular-nums text-brand hover:border-[#bcd0c6]"
          >
            {formatUsd(balanceCents)}
            <small className="text-[11px] font-semibold text-muted">Balance</small>
          </Link>

          <details data-menu="nav" className="relative hidden lg:block">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[12.5px] text-[#4d5a54]">
              <span
                aria-hidden="true"
                className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#e5eee9] text-[11px] font-extrabold text-brand"
              >{initials(agencyName)}</span>
              <span className="sr-only sm:not-sr-only sm:max-w-[220px] sm:truncate">{agencyName}</span>
              <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
                ▾
              </span>
            </summary>
            <div className="absolute right-0 z-40 mt-2.5 flex w-[190px] flex-col rounded-[11px] border border-[#e1e6e3] bg-white p-[7px] shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
              <Link href="/settings" className={dropdownItem}>
                Agency settings
              </Link>
              <Link href="/balance" className={dropdownItem}>
                Balance &amp; top-ups
              </Link>
              <div className="mx-0.5 my-[5px] h-px bg-[#eeeae5]" />
              <SignOutButton className={`w-full ${dropdownItem}`} />
            </div>
          </details>

          <PhoneMenu className="lg:hidden">
            <PhoneMenuSection>
              <MenuLink href="/search" className={phoneMenuItem}>
                Search hotels
              </MenuLink>
            </PhoneMenuSection>
            <PhoneMenuSection title="Quotes">
              <MenuLink href="/quotes" className={phoneMenuItem}>
                All quotes
              </MenuLink>
              <form action={createQuoteAction}>
                <button type="submit" className={phoneMenuItem}>
                  New quote
                </button>
              </form>
              <MenuLink href="/clients" className={phoneMenuItem}>
                Clients
              </MenuLink>
            </PhoneMenuSection>
            <PhoneMenuSection title="Bookings">
              {BOOKINGS.map((item) => (
                <MenuLink key={item.href} href={item.href} className={phoneMenuItem}>
                  {item.label}
                </MenuLink>
              ))}
            </PhoneMenuSection>
            <PhoneMenuSection title="Reporting">
              {REPORTING.map((item) => (
                <MenuLink key={item.href} href={item.href} className={phoneMenuItem}>
                  {item.label}
                </MenuLink>
              ))}
            </PhoneMenuSection>
            <PhoneMenuSection title={agencyName}>
              <MenuLink href="/settings" className={phoneMenuItem}>
                Agency settings
              </MenuLink>
              <MenuLink href="/balance" className={phoneMenuItem}>
                Balance &amp; top-ups
              </MenuLink>
              <SignOutButton className={phoneMenuItem} />
            </PhoneMenuSection>
          </PhoneMenu>
        </div>
      </div>
    </header>
  );
}
