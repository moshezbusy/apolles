import type { Metadata } from "next";
import Link from "next/link";
import { initials } from "@/components/Header";
import { SignOutButton } from "@/components/SignOutButton";
import { btnDanger, btnSecondary, card, link, pageTitle } from "@/components/ui";
import { countryOptions } from "@/lib/countries";
import { formatUsd } from "@/lib/money";
import { LOGO_MAX_BYTES, LOGO_RULE_COPY, getAgencyProfile } from "@/server/agency-profile";
import { assistantConfig } from "@/server/assistant/config";
import { listConnections, type ConnectionListItem } from "@/server/assistant/connections";
import { requireAgent } from "@/server/auth/guards";
import { getQuoteSettings } from "@/server/quote-settings";
import { getAccount } from "@/server/users";
import { getBalance } from "@/server/wallet/ledger";
import { changePasswordAction, removeLogoAction, revokeAssistantAction, updateBrandingAction, updateDefaultsAction, updateProfileAction, uploadLogoAction } from "./actions";
import { LogoForm } from "./logo-form";
import { ProfileForm } from "./profile-form";
import { BrandingForm, ChangePasswordForm, DefaultsForm } from "./quote-forms";
import { TopUpByBankTransfer } from "../balance/top-up";

export const metadata: Metadata = { title: "Agency settings · Apolles", robots: { index: false, follow: false } };

const TABS = [
  { id: "profile", label: "Agency profile" },
  { id: "branding", label: "Quote branding" },
  { id: "preferences", label: "Preferences" },
  { id: "balance", label: "Balance & top-ups" },
  { id: "assistants", label: "AI assistants" },
  { id: "account", label: "Account" },
] as const;
type Tab = (typeof TABS)[number]["id"];

type SearchParams = Promise<{ tab?: string | string[] }>;

// Agency settings (mockup 20): profile, quote branding, preferences, balance, AI assistants and account, one tab
// at a time (?tab=). Everything is read and written for the signed-in agent's own agency only.
// Left out on purpose: card top-ups (no card details anywhere, owner 17.11.2026), the pay-later
// limit (not in phase 1) and ILS prices on quotes (USD only, owner 17.11.2026).
export default async function AgencySettingsPage({ searchParams }: { searchParams?: SearchParams } = {}) {
  const { userId, agencyId } = await requireAgent();
  const raw = (await searchParams)?.tab;
  const tab: Tab = TABS.find((t) => t.id === (Array.isArray(raw) ? raw[0] : raw))?.id ?? "profile";
  const profile = await getAgencyProfile(agencyId);
  if (!profile) throw new Error("Agency not found for the signed-in agent");
  // Only what the open tab shows is read.
  const [settings, account, balance, assistants] = await Promise.all([
    tab === "branding" || tab === "preferences" ? getQuoteSettings(agencyId) : null,
    tab === "branding" || tab === "account" ? getAccount(userId, agencyId) : null,
    tab === "balance" ? getBalance(agencyId) : null,
    tab === "assistants" ? listConnections({ userId, agencyId }) : null,
  ]);

  return (
    <main className="flex-1">
      <div className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 pb-16 pt-8">
        <div>
          <h1 className={pageTitle}>Agency settings</h1>
          <p className="mt-1 text-[13px] text-muted">Agency profile, quote branding, preferences, balance, AI assistants and account.</p>
        </div>
        <nav aria-label="Settings" className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={t.id === "profile" ? "/settings" : `/settings?tab=${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold ${t.id === tab ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {tab === "profile" ? <ProfileTab profile={profile} /> : null}
        {tab === "branding" && settings ? <BrandingTab settings={settings} advisor={account?.name ?? ""} profile={profile} /> : null}
        {tab === "preferences" && settings ? <PreferencesTab settings={settings} /> : null}
        {tab === "balance" && balance ? <BalanceTab balance={balance} reference={profile.bankReference} /> : null}
        {tab === "assistants" && assistants ? <AssistantsTab connections={assistants} connectorUrl={assistantConfig()?.resource ?? null} /> : null}
        {tab === "account" && account ? <AccountTab account={account} /> : null}
      </div>
    </main>
  );
}

type Profile = NonNullable<Awaited<ReturnType<typeof getAgencyProfile>>>;

function ProfileTab({ profile }: { profile: Profile }) {
  return (
    <>

        <section aria-labelledby="details-title" className={`${card} p-6`}>
          <h2 id="details-title" className="text-base font-bold text-ink">
            Agency details
          </h2>
          <p className="mb-5 mt-1 text-[13px] text-muted">Basic information used across Apolles and on vouchers.</p>
          <ProfileForm
            action={updateProfileAction}
            countries={countryOptions()}
            values={{
              name: profile.name,
              email: profile.email ?? "",
              phone: profile.phone ?? "",
              country: profile.country,
            }}
          />
        </section>

        <section aria-labelledby="logo-title" className={`${card} p-6`}>
          <h2 id="logo-title" className="text-base font-bold text-ink">
            Agency logo
          </h2>
          <p className="mb-5 mt-1 text-[13px] text-muted">Shown at the top of your vouchers, instead of Apolles.</p>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="grid h-[96px] w-[220px] shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-white">
              {profile.logoSha256 ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own route, session-scoped; next/image adds nothing
                <img
                  src={`/settings/logo?v=${profile.logoSha256.slice(0, 12)}`}
                  alt={`${profile.name} logo`}
                  className="max-h-[80px] max-w-[200px] object-contain"
                />
              ) : (
                <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-[#e5eee9] text-lg font-extrabold text-brand">
                  {initials(profile.name)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <LogoForm action={uploadLogoAction} rule={LOGO_RULE_COPY} maxBytes={LOGO_MAX_BYTES} />
              {profile.hasLogo ? (
                <form action={removeLogoAction}>
                  <button type="submit" className={link}>
                    Remove logo
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
    </>
  );
}

type Settings = NonNullable<Awaited<ReturnType<typeof getQuoteSettings>>>;

function BrandingTab({ settings, advisor, profile }: { settings: Settings; advisor: string; profile: Profile }) {
  return (
    <section aria-labelledby="branding-title" className={`${card} p-6`}>
      <h2 id="branding-title" className="text-base font-bold text-ink">
        Client quote branding
      </h2>
      <p className="mb-5 mt-1 text-[13px] text-muted">What your clients see on the quote link. Apolles is never shown to them. Empty fields use your agency&apos;s details.</p>
      <BrandingForm
        action={updateBrandingAction}
        values={{
          displayName: settings.displayName,
          advisorName: settings.advisorName,
          contactPhone: settings.contactPhone,
          advisorEmail: settings.advisorEmail,
          defaultLanguage: settings.defaultLanguage,
          brandColor: settings.brandColor,
          defaultMessage: settings.defaultMessage,
        }}
        fallback={{ name: profile.name, advisor, phone: profile.phone ?? "" }}
      />
    </section>
  );
}

function PreferencesTab({ settings }: { settings: Settings }) {
  return (
    <section aria-labelledby="defaults-title" className={`${card} p-6`}>
      <h2 id="defaults-title" className="text-base font-bold text-ink">
        Defaults
      </h2>
      <p className="mb-5 mt-1 text-[13px] text-muted">Used automatically in new quotes. You can change them any time.</p>
      <DefaultsForm
        action={updateDefaultsAction}
        values={{ markupType: settings.defaultMarkupType, markupValue: String(settings.defaultMarkupValue / 100), showCancellation: settings.defaultShowCancellation, validDays: String(settings.validDays) }}
      />
    </section>
  );
}

function BalanceTab({ balance, reference }: { balance: { balanceCents: number; heldCents: number }; reference: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="balance-title" className={`${card} p-6`}>
        <h2 id="balance-title" className="text-base font-bold text-ink">
          Balance
        </h2>
        <p className="mt-1 text-[13px] text-muted">Bookings are paid from this balance. Refunds return to it once a cancellation is confirmed.</p>
        <p className="mt-4 text-xs font-semibold text-muted">Current balance</p>
        <p className="text-[28px] font-bold tabular-nums text-brand">{formatUsd(balance.balanceCents)}</p>
        {balance.heldCents > 0 ? <p className="text-[13px] text-muted">{formatUsd(balance.heldCents)} held for bookings being confirmed</p> : null}
        <Link href="/balance" className={`${btnSecondary} mt-4`}>
          View balance activity
        </Link>
      </section>
      {/* The same top-up wording as the balance page. */}
      <TopUpByBankTransfer reference={reference} />
    </div>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Mockup 20, "AI assistants" (plan 2026-11-22-mcp-search-connector): search only. Connecting starts
// in Claude or ChatGPT (the agent adds the connector address there and signs in to Apolles); this
// tab lists what is connected and disconnects it at once.
function AssistantsTab({ connections, connectorUrl }: { connections: ConnectionListItem[]; connectorUrl: string | null }) {
  return (
    <section aria-labelledby="assistants-title" className={`${card} p-6`}>
      <h2 id="assistants-title" className="text-base font-bold text-ink">
        AI assistants
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        Search hotels from Claude or ChatGPT. Search only: bookings, cancellations and your balance can&apos;t be reached from an AI assistant.
      </p>
      {connectorUrl ? (
        <details className="mt-5 rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand">Connect assistant</summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-[#37413d]">
            <li>In Claude or ChatGPT, add a custom connector.</li>
            <li>
              Paste this address: <code className="select-all rounded bg-[#f5f7f5] px-1.5 py-0.5 text-[12.5px] text-ink">{connectorUrl}</code>
            </li>
            <li>Sign in to Apolles when asked, and allow search only.</li>
          </ol>
        </details>
      ) : (
        <p className="mt-5 text-[13px] text-muted">Connecting an AI assistant is not available yet.</p>
      )}
      <ul className="mt-4 divide-y divide-[#f0eeea] overflow-hidden rounded-xl border border-line" aria-label="Connected assistants">
        {connections.length === 0 ? <li className="bg-[#fbfcfb] px-3 py-3.5 text-center text-xs text-muted">No assistants connected.</li> : null}
        {connections.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-4 bg-white px-3 py-2.5">
            <div className="flex flex-col">
              <strong className="text-sm text-ink">{c.clientName}</strong>
              <span className="text-xs text-muted">
                Connected {DAY.format(c.createdAt)} · {c.lastUsedAt ? `last used ${DAY.format(c.lastUsedAt)}` : "not used yet"}
              </span>
            </div>
            <form action={revokeAssistantAction}>
              <input type="hidden" name="connection" value={c.id} />
              <button type="submit" className={btnDanger}>
                Revoke
              </button>
            </form>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[13px] font-bold text-ink">What the assistant can do</p>
          <ul className="mt-1 list-disc pl-4 text-[12.5px] leading-relaxed text-muted">
            <li>Search hotels and rates</li>
            <li>Open a result in Apolles to book</li>
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[13px] font-bold text-ink">What it can&apos;t do</p>
          <ul className="mt-1 list-disc pl-4 text-[12.5px] leading-relaxed text-muted">
            <li>Book, cancel or issue vouchers</li>
            <li>See guests or your balance</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-muted">Revoking disconnects the assistant right away. To book, open the result in Apolles.</p>
    </section>
  );
}

function AccountTab({ account }: { account: { name: string; email: string } }) {
  return (
    <section aria-labelledby="account-title" className={`${card} p-6`}>
      <h2 id="account-title" className="text-base font-bold text-ink">
        Account
      </h2>
      <p className="mb-5 mt-1 text-[13px] text-muted">Your personal Apolles login.</p>
      <dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
        <dt className="text-muted">Name</dt>
        <dd className="text-ink">{account.name}</dd>
        <dt className="text-muted">Login email</dt>
        <dd className="text-ink">{account.email}</dd>
      </dl>
      <div className="mt-6 flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="text-sm font-bold text-ink">Change password</h3>
        <p className="text-[13px] text-muted">We email you a link to set a new password. You are signed out after 12 hours.</p>
        <ChangePasswordForm action={changePasswordAction} />
      </div>
      <div className="mt-6 flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="text-sm font-bold text-ink">Sign out</h3>
        <p className="text-[13px] text-muted">End the current Apolles session.</p>
        <SignOutButton className={`${btnSecondary} self-start`} />
      </div>
    </section>
  );
}
