import type { Metadata } from "next";
import Link from "next/link";
import { initials } from "@/components/Header";
import { btnPrimary, btnSecondary, card, cell, emptyState, input, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { countryName, countryOptions } from "@/lib/countries";
import { PHONE_NEEDS_COUNTRY_CODE, toE164Digits } from "@/lib/phone";
import { getAgencyProfile } from "@/server/agency-profile";
import { requireAgent } from "@/server/auth/guards";
import { CLIENT_PAGE_SIZE, clientBookings, getClient, listClients, type ClientBooking, type ClientDetail } from "@/server/clients";
import { BookingStatusPill } from "../bookings/status-pill";
import { shortDate } from "../search/parts";
import { RemoveCompanion } from "./remove-companion";
import { quoteCode } from "@/server/quotes/quotes";
import { createQuoteAction } from "../quotes/actions";
import { StatusPill } from "../quotes/parts";
import { addCompanionAction, createClientAction, removeCompanionAction, updateClientAction } from "./actions";
import { ClientForm } from "./client-form";
import { CompanionForm } from "./companion-form";

export const metadata: Metadata = { title: "Clients | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function travelerLine(c: { relation: string; childAge: number | null }): string {
  const who = c.childAge === null ? "Adult" : `${c.childAge} ${c.childAge === 1 ? "year" : "years"} old`;
  return c.relation ? `${c.relation} · ${who}` : who;
}

// Screen 18: the agency's clients. The list is on the left; the open client (or the add / edit
// form) on the right. On a phone the open client or the form comes first, above the list, and
// every link to it lands on it (#client), so the agent sees what they opened. Everything is read
// for the signed-in agent's own agency only.
export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const params = await searchParams;
  const q = one(params.q).slice(0, 100);
  const shownParam = Number(one(params.shown));
  const shown = Number.isInteger(shownParam) ? Math.min(Math.max(CLIENT_PAGE_SIZE, shownParam), 500) : CLIENT_PAGE_SIZE;
  const adding = one(params.new) === "1";
  const editing = one(params.edit) === "1";
  // Something the agent opened (not the first client shown by default): first on a phone.
  const opened = adding || editing || one(params.id) !== "";

  const [page, profile] = await Promise.all([
    listClients(agencyId, { q, take: shown }),
    getAgencyProfile(agencyId),
  ]);
  const openId = one(params.id) || page.clients[0]?.id || "";
  const open = openId && !adding ? await getClient(agencyId, openId) : null;
  const bookings = open ? await clientBookings(agencyId, open) : [];

  // Links keep the search and how many clients are shown. A link that opens a client or a form
  // lands on it (#client).
  const hrefFor = (values: { id?: string; shown?: number; extra?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const count = values.shown ?? shown;
    if (count > CLIENT_PAGE_SIZE) p.set("shown", String(count));
    if (values.id) p.set("id", values.id);
    if (values.extra) p.set(values.extra, "1");
    const s = p.toString();
    const hash = values.id || values.extra ? "#client" : "";
    return (s ? "/clients?" + s : "/clients") + hash;
  };
  const countries = countryOptions();
  const total = page.total;

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] pb-16 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Clients</h1>
          <p className="mt-1 text-[13px] text-muted">Your clients and their travel companions.</p>
        </div>
        <Link href={hrefFor({ extra: "new" })} className={btnPrimary}>
          + Add client
        </Link>
      </div>

      <form method="get" action="/clients" className="mt-5 flex items-center gap-3">
        <input
          type="search"
          name="q"
          aria-label="Search clients"
          defaultValue={q}
          maxLength={100}
          placeholder="Search by name, email or phone"
          className={input}
        />
        <span className="shrink-0 text-[13px] text-muted">
          {total} {total === 1 ? "client" : "clients"}
        </span>
      </form>

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* min-w-0: on a phone the wide table scrolls inside its card instead of widening the page. */}
        <div className="min-w-0">
          {page.clients.length === 0 ? (
            <p className={emptyState}>{q ? "No clients match your search." : "No clients yet. Add your first client."}</p>
          ) : (
            <div className={tableWrap}>
              <table className={table}>
                <thead className={thead}>
                  <tr>
                    <th className={th}>Client</th>
                    <th className={th}>Contact</th>
                    <th className={th}>Travelers</th>
                    <th className={th}>Quotes</th>
                    <th className={th}>Last activity</th>
                  </tr>
                </thead>
                <tbody className={tbody}>
                  {page.clients.map((c) => (
                    <tr key={c.id} className={`${tr} ${c.id === open?.id ? "bg-brand-soft" : ""}`}>
                      <td data-label="Client" className={cell}>
                        <Link href={hrefFor({ id: c.id })} className="font-bold text-ink hover:underline">
                          {c.firstName} {c.lastName}
                        </Link>
                        <span className="block text-xs text-muted">{countryName(c.nationality)}</span>
                      </td>
                      <td data-label="Contact" className={td}>
                        {c.email ?? "No email"}
                        <span className="block text-xs text-muted">{c.phone}</span>
                      </td>
                      <td data-label="Travelers" className={`${td} tabular-nums`}>{c.travelers}</td>
                      <td data-label="Quotes" className={`${td} tabular-nums`}>{c.quotes}</td>
                      <td data-label="Last activity" className={td}>
                        {dayMonth.format(c.updatedAt)}
                        <span className="block text-xs text-muted">Client updated</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {page.nextCursor && shown < 500 ? (
            <p className="mt-4">
              <Link href={hrefFor({ shown: shown + CLIENT_PAGE_SIZE })} scroll={false} className={btnSecondary}>
                Load more
              </Link>
            </p>
          ) : null}
        </div>

        <aside id="client" aria-label="Client" className={`${card} scroll-mt-24 p-5 ${opened ? "max-lg:order-first" : ""}`}>
          {adding ? (
            <>
              <h2 className="mb-4 text-base font-bold text-ink">Add client</h2>
              <ClientForm
                action={createClientAction}
                countries={countries}
                cancelHref={hrefFor({})}
                values={{ firstName: "", lastName: "", phone: "", email: "", nationality: profile?.country ?? "", notes: "" }}
              />
            </>
          ) : open && editing ? (
            <>
              <h2 className="mb-4 text-base font-bold text-ink">Edit client</h2>
              <ClientForm
                action={updateClientAction}
                countries={countries}
                clientId={open.id}
                cancelHref={hrefFor({ id: open.id })}
                values={{
                  firstName: open.firstName,
                  lastName: open.lastName,
                  phone: open.phone,
                  email: open.email ?? "",
                  nationality: open.nationality,
                  notes: open.notes,
                }}
              />
            </>
          ) : open ? (
            <ClientPanel client={open} bookings={bookings} editHref={hrefFor({ id: open.id, extra: "edit" })} country={profile?.country ?? ""} />
          ) : (
            <p className="text-sm text-muted">Choose a client to see their details.</p>
          )}
        </aside>
      </div>
    </main>
  );
}

// `country`: the agency's country, whose calling code a number typed the local way gets.
function ClientPanel({ client, bookings, editHref, country }: { client: ClientDetail; bookings: ClientBooking[]; editHref: string; country: string }) {
  const name = `${client.firstName} ${client.lastName}`;
  // The stored number is never rewritten; the agent is told when no WhatsApp link can be made from it.
  const phoneHint = toE164Digits(client.phone, country) ? null : PHONE_NEEDS_COUNTRY_CODE;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#e5eee9] text-sm font-extrabold text-brand">
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-serif text-[24px] leading-tight text-ink">{name}</h2>
          <span className="text-xs text-muted">Client since {monthYear.format(client.createdAt)}</span>
        </div>
        <Link href={editHref} className={btnSecondary}>
          Edit
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <form action={createQuoteAction}>
          <input type="hidden" name="clientId" value={client.id} />
          <button type="submit" className={`${btnPrimary} w-full`} title="Opens a new quote with this client already chosen">
            New quote
          </button>
        </form>
        <Link href="/search" className={`${btnSecondary} w-full`}>
          Search hotels for this client
        </Link>
        <p className="text-xs text-muted">On the guest details page, choose {name} under Choose from clients: the names and contact are filled in.</p>
      </div>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-bold text-ink">Details</h3>
        <dl className="flex flex-col gap-2 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Email</dt>
            <dd className="break-all text-right font-semibold text-ink">{client.email ?? "None"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">WhatsApp phone</dt>
            <dd className="text-right font-semibold text-ink">{client.phone}</dd>
          </div>

          <div className="flex justify-between gap-3">
            <dt className="text-muted">Nationality</dt>
            <dd className="text-right font-semibold text-ink">{countryName(client.nationality)}</dd>
          </div>
          {client.notes ? (
            <div className="flex flex-col gap-1">
              <dt className="text-muted">Notes</dt>
              <dd className="whitespace-pre-line text-ink">{client.notes}</dd>
            </div>
          ) : null}
        </dl>
        {phoneHint ? (
          <p role="note" className="mt-2 text-xs font-semibold text-[#8a6a10]">
            {phoneHint}
          </p>
        ) : null}
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-bold text-ink">Travel companions</h3>
        <ul className="flex flex-col divide-y divide-[#f0ece4] text-[13px]">
          <li className="flex justify-between gap-3 py-2">
            <strong className="text-ink">{name}</strong>
            <span className="text-muted">Lead · Adult</span>
          </li>
          {client.companions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <strong className="text-ink">
                {c.firstName} {c.lastName}
              </strong>
              <span className="flex items-center gap-3 text-muted">
                {travelerLine(c)}
                <RemoveCompanion action={removeCompanionAction} companionId={c.id} name={`${c.firstName} ${c.lastName}`} />
              </span>
            </li>
          ))}
        </ul>
        {/* key: a new client gets a fresh form, never the last client's message or typed values. */}
        <CompanionForm key={client.id} action={addCompanionAction} clientId={client.id} />
        <p className="mt-2 text-xs text-muted">Check children&apos;s ages for each trip.</p>
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-bold text-ink">Bookings</h3>
        {bookings.length === 0 ? (
          <p className="text-[13px] text-muted">No bookings yet. Bookings from this client&apos;s quotes, or with this client&apos;s email as the lead guest, show here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bookings.map((b) => (
              <li key={b.id}>
                <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2 hover:border-[#bcd0c6]">
                  <span className="min-w-0">
                    <strong className="block truncate text-[13px] text-ink">{b.hotelName}</strong>
                    <span className="text-xs text-muted">
                      <span className="font-mono">{b.reference}</span> · {shortDate(b.checkin)} to {shortDate(b.checkout)}
                    </span>
                  </span>
                  <BookingStatusPill status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="mb-2 text-sm font-bold text-ink">Quotes</h3>
        {client.quotes.length === 0 ? (
          <p className="text-[13px] text-muted">No quotes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {client.quotes.map((q) => (
              <li key={q.id}>
                <Link href={`/quotes/${q.id}`} className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2 hover:border-[#bcd0c6]">
                  <span className="min-w-0">
                    <strong className="block truncate text-[13px] text-ink">{q.title || "Untitled quote"}</strong>
                    <span className="text-xs text-muted">{quoteCode(q.number)}</span>
                  </span>
                  <StatusPill status={q.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
