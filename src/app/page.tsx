import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, card, eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Apolles | Hotel Booking Platform for Travel Professionals",
  description: "Search live hotel rates, compare rooms, create client quotes and manage bookings in one place. For verified travel professionals.",
};

const FEATURES = [
  { n: "01", title: "Live Hotel Rates", text: "Search current hotel availability and professional rates." },
  { n: "02", title: "Compare Rooms & Conditions", text: "Compare room types, meal plans and cancellation terms." },
  { n: "03", title: "Create Client Quotes", text: "Build clear client-facing hotel proposals from selected options." },
  { n: "04", title: "Manage Bookings", text: "Keep quotes and bookings organized in one agent workspace." },
];

const STEPS = [
  { n: "STEP 01", title: "Apply", text: "Send your agency details." },
  { n: "STEP 02", title: "Get approved", text: "We verify your travel business." },
  { n: "STEP 03", title: "Start booking", text: "Access hotel search, quotes and bookings." },
];

const QUOTE_POINTS = ["Several destinations in one proposal", "Your selling price, never the net rate", "Cancellation terms shown for every room", "You see when the client opens the quote"];

const FAQ = [
  { q: "Who can join Apolles?", a: "Verified travel professionals and travel businesses. Applications are reviewed before platform access is activated. Joining is free." },
  { q: "Can public visitors search hotel prices?", a: "No. Hotel search, availability and professional pricing are available only after agent login." },
  { q: "Which destinations and hotels are available?", a: "Hotels in the countries we cover, with live availability and current rates. Type a city, an area or a hotel's name, then choose your dates and guests." },
  { q: "Can I send branded hotel quotes to clients?", a: "Yes. Select hotel options, set your selling price and send your client a link to a clean proposal they can choose from." },
  { q: "What does my client see?", a: "Your client sees the hotel and room options with your selling price, the meal plan and the cancellation terms. Net rates, your profit and supplier details are never shown to the client." },
];

// Screen 01: the public homepage. It shows no prices or hotels (those are for signed-in agents).
// The product pictures are drawn here with sample names, not real rates.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-canvas">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-[72px] w-[min(1200px,calc(100%-40px))] items-center gap-6">
          <Link href="/" className="font-serif text-[27px] text-ink">
            Apolles
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-[13px] font-semibold text-[#4d5a54] md:flex">
            <a href="#features" className="hover:text-brand">Platform Features</a>
            <a href="#how" className="hover:text-brand">How It Works</a>
            <a href="#faq" className="hover:text-brand">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="hidden text-[13px] font-semibold text-[#4d5a54] hover:text-brand sm:block">
              Agent Login
            </Link>
            <Link href="/join" className={btnPrimary}>
              Join Apolles
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-[min(1200px,calc(100%-40px))] items-center gap-10 py-16 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <p className={eyebrow}>Built for travel professionals</p>
            <h1 className="mt-3 font-serif text-[44px] leading-[1.05] text-ink sm:text-[56px]">Hotel booking, built for travel agents</h1>
            <p className="mt-4 max-w-[520px] text-[17px] text-[#4d5a54]">Search live rates, compare rooms, create client quotes and manage bookings in one place.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/join" className={btnPrimary}>
                Join as a Travel Agent
              </Link>
              <Link href="/login" className={btnSecondary}>
                Agent Login
              </Link>
            </div>
            <p className="mt-3 text-[13px] text-muted">Free to join. Available exclusively to verified travel professionals.</p>
          </div>
          <ProductPicture />
        </section>

        <section id="features" className="border-y border-line bg-white py-16">
          <div className="mx-auto w-[min(1200px,calc(100%-40px))]">
            <p className={eyebrow}>One professional workspace</p>
            <h2 className="mt-2 font-serif text-[34px] text-ink">The core tools agents need</h2>
            <p className="mt-2 max-w-[640px] text-[15px] text-[#4d5a54]">Everything from the first search to the confirmed booking, without switching between supplier sites and spreadsheets.</p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <li key={f.n} className={`${card} p-5`}>
                  <span className="text-xs font-extrabold text-gold">{f.n}</span>
                  <h3 className="mt-2 text-[16px] font-bold text-ink">{f.title}</h3>
                  <p className="mt-1 text-[14px] text-[#4d5a54]">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="mx-auto w-[min(1200px,calc(100%-40px))] py-16">
          <p className={eyebrow}>How it works</p>
          <h2 className="mt-2 font-serif text-[34px] text-ink">Apply. Get approved. Start booking.</h2>
          <p className="mt-2 text-[15px] text-[#4d5a54]">Access is available to verified travel professionals.</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className={`${card} bg-white p-5`}>
                <span className="text-xs font-extrabold tracking-[0.12em] text-muted">{s.n}</span>
                <h3 className="mt-2 text-[18px] font-bold text-ink">{s.title}</h3>
                <p className="mt-1 text-[14px] text-[#4d5a54]">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-line bg-white py-16">
          <div className="mx-auto grid w-[min(1200px,calc(100%-40px))] items-center gap-10 lg:grid-cols-2">
            <div>
              <p className={eyebrow}>Client quotes</p>
              <h2 className="mt-2 font-serif text-[34px] text-ink">Send options. Let your client choose.</h2>
              <p className="mt-2 text-[15px] text-[#4d5a54]">
                Collect hotels while you search, set your selling price, and send one clean link. Your client picks a hotel and room for each destination and sends the choice back to you.
              </p>
              <ul className="mt-5 flex flex-col gap-2 text-[14px] text-ink">
                {QUOTE_POINTS.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
                      ✓
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <QuotePicture />
          </div>
        </section>

        <section id="faq" className="mx-auto w-[min(900px,calc(100%-40px))] py-16">
          <p className={eyebrow}>Agent FAQ</p>
          <h2 className="mt-2 font-serif text-[34px] text-ink">Before you apply</h2>
          <div className="mt-6 flex flex-col gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className={`${card} bg-white p-5`}>
                <summary className="cursor-pointer text-[15px] font-bold text-ink">{f.q}</summary>
                <p className="mt-2 text-[14px] text-[#4d5a54]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="bg-brand py-14 text-paper">
          <div className="mx-auto flex w-[min(1200px,calc(100%-40px))] flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#cfe2d8]">Apolles for travel professionals</p>
              <h2 className="mt-2 font-serif text-[32px]">Ready to access Apolles?</h2>
              <p className="mt-1 text-[15px] text-[#cfe2d8]">Apply for agent access. It&apos;s free, and once your agency is verified you can start searching and booking.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/join" className="rounded-[12px] bg-paper px-5 py-3 text-[14px] font-bold text-brand hover:bg-white">
                Apply for Access
              </Link>
              <Link href="/login" className="rounded-[12px] border border-white/40 px-5 py-3 text-[14px] font-bold text-paper hover:bg-white/10">
                Agent Login
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white py-6 text-[13px] text-muted">
        <div className="mx-auto flex w-[min(1200px,calc(100%-40px))] flex-wrap items-center gap-4">
          <span className="font-serif text-[18px] text-ink">Apolles</span>
          <span>Hotel booking tools for verified travel professionals.</span>
          <nav aria-label="Footer" className="ml-auto flex gap-4">
            <Link href="/login" className="hover:text-brand">Agent Login</Link>
            <Link href="/terms" className="hover:text-brand">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// A drawn picture of the agent's search screen (sample names, no real rates).
function ProductPicture() {
  const rows = [
    { name: "Costa Serena Resort", meta: "Hotel Zone · Junior Suite Ocean View", tag: "Free cancellation", action: "✓ In quote" },
    { name: "Palma Blanca Suites", meta: "Playa Mujeres · King Suite Plunge Pool", tag: "All inclusive", action: "+ Add to quote" },
    { name: "Hotel Marea", meta: "Hotel Zone · Deluxe Ocean View", tag: "Breakfast included", action: "+ Add to quote" },
  ];
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_25px_60px_rgba(19,47,39,0.12)]">
      <div className="flex items-center gap-2 border-b border-line bg-[#f7f5f0] px-4 py-2.5 text-xs text-muted">
        <span className="h-2.5 w-2.5 rounded-full bg-[#e3ded3]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e3ded3]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e3ded3]" />
        <span className="ml-2 rounded-md bg-white px-2 py-0.5">apolles.com/search</span>
      </div>
      <div className="grid grid-cols-3 gap-2 border-b border-line p-4 text-xs">
        <div className="rounded-[10px] border border-line p-2">
          <span className="block font-bold text-muted">DESTINATION</span>Cancún, Mexico
        </div>
        <div className="rounded-[10px] border border-line p-2">
          <span className="block font-bold text-muted">DATES</span>Oct 12 to Oct 17
        </div>
        <div className="rounded-[10px] border border-line p-2">
          <span className="block font-bold text-muted">GUESTS</span>2 adults · 1 room
        </div>
      </div>
      <ul className="flex flex-col gap-2 p-4">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 rounded-[12px] border border-line p-3">
            <span className="h-12 w-16 shrink-0 rounded-[8px] bg-gradient-to-br from-[#cfe0d6] to-[#e9e4da]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-ink">{r.name}</span>
              <span className="block truncate text-[11px] text-muted">{r.meta}</span>
              <span className="text-[11px] font-semibold text-[#2f7d4a]">{r.tag}</span>
            </span>
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold text-brand">{r.action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A drawn picture of a client proposal (sample names, no real rates).
function QuotePicture() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-[20px] border border-line bg-canvas shadow-[0_25px_60px_rgba(19,47,39,0.12)]">
      <div className="flex items-center gap-3 border-b border-line bg-white p-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e5eee9] text-sm font-extrabold text-brand">TA</span>
        <span>
          <span className="block text-[14px] font-bold text-ink">Your Travel Agency</span>
          <span className="block text-xs text-muted">Prepared by your travel advisor</span>
        </span>
      </div>
      <div className="p-4">
        <p className="text-xs text-muted">Your travel proposal</p>
        <p className="font-serif text-[24px] text-ink">Mexico Honeymoon</p>
        <p className="text-xs text-muted">Oct 12 to Oct 20 · 2 adults · 2 destinations</p>
        <div className="mt-3 rounded-[14px] border border-brand bg-white p-3">
          <p className="text-[13px] font-bold text-ink">Cancún · Costa Serena Resort</p>
          <p className="text-xs text-muted">Junior Suite Ocean View · All inclusive</p>
          <p className="text-xs font-semibold text-[#2f7d4a]">Free cancellation until Oct 5</p>
        </div>
        <div className="mt-2 rounded-[14px] border border-line bg-white p-3">
          <p className="text-[13px] font-bold text-ink">Tulum · Selva Tulum Hotel</p>
          <p className="text-xs text-muted">Jungle Suite · Breakfast included</p>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-[12px] bg-white p-3 text-[13px]">
          <span className="font-bold text-ink">1 of 2 destinations selected</span>
          <span className="rounded-[10px] bg-brand px-3 py-1.5 text-xs font-bold text-paper">Send my selections</span>
        </div>
      </div>
    </div>
  );
}
