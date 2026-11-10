import type { Metadata } from "next";
import { initials } from "@/components/Header";
import { card, link, pageTitle } from "@/components/ui";
import { countryOptions } from "@/lib/countries";
import { LOGO_MAX_BYTES, LOGO_RULE_COPY, getAgencyProfile } from "@/server/agency-profile";
import { requireAgent } from "@/server/auth/guards";
import { removeLogoAction, updateProfileAction, uploadLogoAction } from "./actions";
import { LogoForm } from "./logo-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Agency settings · Apolles", robots: { index: false, follow: false } };

// Agency settings (mockup 20, "Agency profile" tab only: the other tabs are later phases).
// Everything is read and written for the signed-in agent's own agency only.
export default async function AgencySettingsPage() {
  const { agencyId } = await requireAgent();
  const profile = await getAgencyProfile(agencyId);
  if (!profile) throw new Error("Agency not found for the signed-in agent");

  return (
    <main className="flex-1">
      <div className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 pb-16 pt-8">
        <div>
          <h1 className={pageTitle}>Agency settings</h1>
          <p className="mt-1 text-[13px] text-muted">Your agency&apos;s details, shown on your vouchers and invoices.</p>
        </div>

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
      </div>
    </main>
  );
}
