import { alertSuccess, btnDanger, btnPrimary, card, inputUnsized, link } from "@/components/ui";
import type { ConnectionListItem } from "@/server/ai/tokens";

// AI assistants tab (mockup 20): connect Claude or ChatGPT (search only), see and revoke them.

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function lastUsed(at: Date | null, now: Date): string {
  if (!at) return "never used";
  return DAY.format(at) === DAY.format(now) ? "last used today" : `last used ${DAY.format(at)}`;
}

const CLAUDE_STEPS = [
  "In Claude, open Settings → Connectors → Add custom connector.",
  "Paste the link above and click Add.",
  "Sign in to Apolles when asked and click Allow.",
];
const CHATGPT_STEPS = [
  "In ChatGPT, open Settings → Connectors (or Apps) and add a custom connector.",
  "Paste the link above as the server URL, with OAuth sign-in.",
  "Sign in to Apolles when asked and click Allow.",
];

export function AiTab({
  connections,
  nextCursor,
  connectUrl,
  revoked,
  connectAction,
  revokeAction,
}: {
  connections: ConnectionListItem[];
  nextCursor: string | null;
  connectUrl: string | null; // set only right after "Connect assistant"
  revoked: boolean;
  connectAction: () => Promise<void>;
  revokeAction: (formData: FormData) => Promise<void>;
}) {
  const now = new Date();
  return (
    <section aria-labelledby="ai-title" className={`${card} p-6`}>
      <h2 id="ai-title" className="text-base font-bold text-ink">
        AI assistants
      </h2>
      <p className="mb-5 mt-1 text-[13px] text-muted">
        Search hotels from Claude or ChatGPT. Search only: bookings, cancellations and your balance can&apos;t be reached from an AI assistant.
      </p>
      {revoked ? (
        <p role="status" className={`${alertSuccess} mb-4`}>
          Assistant disconnected.
        </p>
      ) : null}
      <form action={connectAction}>
        <button type="submit" className={btnPrimary}>
          Connect assistant
        </button>
      </form>

      {connectUrl ? (
        <div className="mt-5 rounded-xl border border-line p-4">
          <h3 className="text-sm font-bold text-ink">Your connection link</h3>
          <input readOnly aria-label="Your connection link" value={connectUrl} className={`${inputUnsized} mt-2 w-full font-mono`} />
          <p className="mt-2 text-[13px] text-muted">This link works for the next 10 minutes. Start the connection in Claude or ChatGPT now.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-xs font-bold text-ink">Claude</h4>
              <ol className="mt-1 list-decimal pl-5 text-[13px] text-ink">
                {CLAUDE_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            <div>
              <h4 className="text-xs font-bold text-ink">ChatGPT</h4>
              <ol className="mt-1 list-decimal pl-5 text-[13px] text-ink">
                {CHATGPT_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : null}

      <ul className="mt-5 divide-y divide-[#f0ece4] rounded-xl border border-line">
        {connections.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex flex-col">
              <strong className="text-sm text-ink">{c.assistant}</strong>
              <span className="text-[13px] text-muted">
                Connected {DAY.format(c.createdAt)} · {lastUsed(c.lastUsedAt, now)}
              </span>
            </div>
            <form action={revokeAction}>
              <input type="hidden" name="connectionId" value={c.id} />
              <button type="submit" className={btnDanger}>
                Revoke
              </button>
            </form>
          </li>
        ))}
        {connections.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No assistants connected.</li> : null}
      </ul>
      {nextCursor ? (
        <p className="mt-3">
          <a href={`/settings?tab=ai&cursor=${nextCursor}`} className={link}>
            Show more
          </a>
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-bold text-muted">What the assistant can do</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink">
            <li>Search hotels and rates</li>
            <li>Open a result in Apolles to book</li>
          </ul>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-bold text-muted">What it can&apos;t do</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink">
            <li>Book, cancel or issue vouchers</li>
            <li>See guests or your balance</li>
          </ul>
        </div>
      </div>
      <p className="mt-5 rounded-[9px] border border-[#d3e3da] bg-brand-soft px-3 py-2.5 text-sm text-brand">
        Revoking disconnects the assistant right away. To book, open the result in Apolles.
      </p>
    </section>
  );
}
