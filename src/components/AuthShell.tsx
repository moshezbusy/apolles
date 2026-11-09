import { card, eyebrow as eyebrowClass } from "@/components/ui";

// Frame of the signed-out pages (mockups 04, 05, 06): wordmark header, a centered card under a
// serif title, and the dark footer. No navigation and no links out: phase 1 has no public
// pages, and the half-signed-in admin (2FA) must not see the admin menu.
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  wide = false,
  children,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[radial-gradient(circle_at_85%_10%,rgba(184,145,85,0.12),transparent_25%),linear-gradient(180deg,#fbf8f0_0%,#fffdf8_55%)]">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-[78px] w-[min(1180px,calc(100%-40px))] items-center">
          <span className="font-serif text-[29px] font-medium tracking-[0.02em] text-ink">Apolles</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className={`w-full ${wide ? "max-w-[520px]" : "max-w-[430px]"}`}>
          {title ? (
            <div className="mb-6 text-center">
              {eyebrow ? <p className={`mb-3 ${eyebrowClass}`}>{eyebrow}</p> : null}
              <h1 className="mb-3 font-serif text-[40px] font-medium leading-none tracking-[-0.035em] text-ink sm:text-[44px]">
                {title}
              </h1>
              {subtitle ? <p className="text-sm text-[#65706a]">{subtitle}</p> : null}
            </div>
          ) : null}
          <section className={card}>
            <div className="p-6">{children}</div>
          </section>
        </div>
      </main>

      <footer className="bg-footer py-7 text-[#d9e2de]">
        <div className="mx-auto w-[min(1180px,calc(100%-40px))]">
          <p className="font-serif text-2xl text-paper">Apolles</p>
          <p className="text-xs text-[#9db0a8]">Hotel booking tools for verified travel professionals.</p>
        </div>
      </footer>
    </div>
  );
}
