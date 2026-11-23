"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { alertError, alertInfo, alertSuccess, btnPrimary, btnSecondary, inputUnsized } from "@/components/ui";
import type { EmailPreview } from "@/server/quotes/sharing";
import type { SendState } from "../actions";
import { useQuoteDirty } from "./dirty";

const WHATSAPP_START = "https://wa.me/";

type Action = (quoteId: string, confirmNetPrice?: boolean) => Promise<SendState>;
type Kind = "whatsapp" | "email" | "copy";
type Shown = Extract<EmailPreview, { ok: true }>;

const CONFIRM_LABEL: Record<Kind, { plain: string; anyway: string }> = {
  whatsapp: { plain: "Open WhatsApp", anyway: "Open WhatsApp anyway" },
  email: { plain: "Send email", anyway: "Send email anyway" },
  copy: { plain: "Copy client link", anyway: "Copy link anyway" },
};

// "Send quote" (mockup 15): WhatsApp opens the agent's own WhatsApp with the message and the link
// ready (Apolles sends nothing there); Email is sent by Apolles in the agency's name; Copy link
// copies the client link. Each one marks a draft as sent. Preview shows the client page.
// All of them read the SAVED quote: while the settings form above holds unsaved changes they are
// off. A quote that would show the client the agency's cost price (no markup saved) is sent only
// after the agent says so here.
// Before anything goes out, a dialog (mockup 15) shows what to check (`checks`: no client, no
// profit, dates or free cancellation passed, prices to refresh) with "Send anyway"; for email it
// also shows the recipient, the subject, the message and the link exactly as they will be sent.
export function SendPanel({
  quoteId,
  shareUrl,
  hasClient,
  hasEmail,
  phoneHint,
  closed,
  checks = [],
  actions,
}: {
  quoteId: string;
  shareUrl: string | null;
  hasClient: boolean;
  hasEmail: boolean;
  // Set when the client's number cannot be made into a WhatsApp link (no country code).
  phoneHint: string | null;
  closed: boolean;
  checks?: string[];
  actions: { copy: Action; whatsapp: Action; email: Action; renew: Action; preview: (quoteId: string) => Promise<EmailPreview> };
}) {
  const { dirty } = useQuoteDirty();
  const [url, setUrl] = useState(shareUrl);
  // The server's link wins when it changes (a new link, or withdrawn after another client was set),
  // so a dead link is never left on screen; the message stays.
  const [serverUrl, setServerUrl] = useState(shareUrl);
  if (shareUrl !== serverUrl) {
    setServerUrl(shareUrl);
    setUrl(shareUrl);
  }
  const [state, setState] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // The send that waits for "send at cost price?".
  const [atCost, setAtCost] = useState<Kind | null>(null);
  const [pending, start] = useTransition();
  const off = pending || dirty || closed;
  // The dialog before a send: which send, and for email what will be sent.
  const [dialog, setDialog] = useState<{ kind: Kind; email: Shown | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!dialog) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setDialog(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [dialog]);

  function ask(kind: Kind) {
    setState(null);
    if (kind !== "email") {
      if (checks.length === 0) return run(kind);
      setDialog({ kind, email: null, error: null });
      return;
    }
    setDialog({ kind, email: null, error: null });
    start(async () => {
      const result = await actions.preview(quoteId);
      if (!result.ok) {
        setDialog({ kind, email: null, error: result.error });
        return;
      }
      setUrl(result.url);
      setDialog({ kind, email: result, error: null });
    });
  }

  function run(kind: Kind) {
    setDialog(null);
    if (kind === "whatsapp") whatsapp();
    else if (kind === "email") email();
    else copy();
  }

  // false: the server asked for the cost-price yes (shown with its own button).
  function refused(kind: Kind, result: SendState): result is Extract<SendState, { ok: false }> {
    if (result.ok) return false;
    setAtCost(result.confirm === "netPrice" ? kind : null);
    setState({ kind: "error", text: result.error });
    return true;
  }

  function whatsapp(confirm = false) {
    // Opened now, while the click still counts as the agent's, then pointed at WhatsApp.
    const tab = window.open("", "_blank");
    start(async () => {
      const result = await actions.whatsapp(quoteId, confirm);
      // Only ever a WhatsApp address: the part after the fixed start is all that comes from the server.
      const rest = result.ok && result.url?.startsWith(WHATSAPP_START) ? result.url.slice(WHATSAPP_START.length) : null;
      if (refused("whatsapp", result) || !rest) {
        tab?.close();
        if (result.ok) setState({ kind: "error", text: "WhatsApp could not be opened. Try again, or copy the client link." });
        return;
      }
      setAtCost(null);
      if (tab) {
        tab.opener = null;
        tab.location.href = "https://wa.me/" + rest;
      } else window.location.href = "https://wa.me/" + rest;
      setState({ kind: "ok", text: "WhatsApp opened with the message. The quote is marked as sent." });
    });
  }

  function copy(confirm = false) {
    start(async () => {
      const result = await actions.copy(quoteId, confirm);
      if (refused("copy", result) || !result.url) {
        if (result.ok) setState({ kind: "error", text: "The link could not be made. Try again in a moment." });
        return;
      }
      setAtCost(null);
      setUrl(result.url);
      try {
        await navigator.clipboard.writeText(result.url);
        setState({ kind: "ok", text: "Link copied. The quote is marked as sent." });
      } catch {
        setState({ kind: "ok", text: "Link ready below. Copy it by hand." });
      }
    });
  }

  function renew() {
    if (!window.confirm("Make a new client link? The old link stops working at once.")) return;
    start(async () => {
      const result = await actions.renew(quoteId);
      if (!result.ok || !result.url) {
        setState({ kind: "error", text: result.ok ? "A new link could not be made. Try again in a moment." : result.error });
        return;
      }
      setUrl(result.url);
      setState({ kind: "ok", text: "New link ready. The old link no longer works." });
    });
  }

  function email(confirm = false) {
    start(async () => {
      const result = await actions.email(quoteId, confirm);
      if (refused("email", result)) return;
      setAtCost(null);
      setState({ kind: "ok", text: result.message ?? "Email sent." });
    });
  }

  const sendAtCost = { whatsapp: () => whatsapp(true), email: () => email(true), copy: () => copy(true) };

  return (
    <div className="flex flex-col gap-3">
      {dirty ? (
        <p role="status" className={alertInfo}>
          Save your changes first. What you typed above (client, message, language or markup) is not saved yet, so the client would not get it.
        </p>
      ) : null}
      {closed ? <p className={alertInfo}>This quote is closed. Choose Reopen quote to send it again.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => ask("whatsapp")} disabled={off || !hasClient || !!phoneHint} className={btnPrimary} title={hasClient ? "" : "Choose the client first"}>
          Send on WhatsApp
        </button>
        <button type="button" onClick={() => ask("email")} disabled={off || !hasEmail} className={btnSecondary} title={hasEmail ? "" : "The client has no email"}>
          Send by email
        </button>
        <button type="button" onClick={() => ask("copy")} disabled={off} className={btnSecondary}>
          Copy client link
        </button>
        {dirty ? (
          <span aria-disabled="true" className={`${btnSecondary} cursor-not-allowed opacity-60`}>
            Preview
          </span>
        ) : (
          <Link href={`/quotes/${quoteId}/preview`} className={btnSecondary}>
            Preview
          </Link>
        )}
      </div>
      {pending && !dialog ? (
        <p role="status" className="text-xs text-muted">
          Sending…
        </p>
      ) : null}
      {phoneHint ? <p className="text-xs font-semibold text-[#8a6a10]">{phoneHint}</p> : null}
      {url ? (
        <div className="flex gap-2">
          <input readOnly value={url} aria-label="Client link" className={`${inputUnsized} min-w-0 flex-1 text-base sm:text-xs`} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={renew} disabled={off} className={btnSecondary}>
            New link
          </button>
        </div>
      ) : null}
      {state ? (
        <p role={state.kind === "error" ? "alert" : "status"} className={state.kind === "error" ? alertError : alertSuccess}>
          {state.text}
        </p>
      ) : null}
      {atCost && !dirty ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={sendAtCost[atCost]} disabled={off} className={btnSecondary}>
            {pending ? "Sending…" : "Send at cost price"}
          </button>
          <button type="button" onClick={() => { setAtCost(null); setState(null); }} disabled={pending} className="text-sm font-semibold text-muted hover:text-ink">
            Cancel sending
          </button>
        </div>
      ) : null}
      <p className="text-xs text-muted">Copying the link, opening WhatsApp or sending the email marks the quote as sent and starts the offer&apos;s validity again.</p>
      {dialog ? (
        <SendDialog
          kind={dialog.kind}
          email={dialog.email}
          error={dialog.error}
          checks={checks}
          pending={pending}
          onCancel={() => setDialog(null)}
          onSend={() => run(dialog.kind)}
        />
      ) : null}
    </div>
  );
}

function SendDialog({
  kind,
  email,
  error,
  checks,
  pending,
  onCancel,
  onSend,
}: {
  kind: Kind;
  email: Shown | null;
  error: string | null;
  checks: string[];
  pending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const field = "text-xs font-semibold text-[#37413d]";
  const loading = kind === "email" && !email && !error;
  const label = CONFIRM_LABEL[kind];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#13201b]/40 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="send-dialog-title" className="flex max-h-[90vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_24px_60px_rgba(19,47,39,0.25)]">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h3 id="send-dialog-title" className="text-base font-bold text-ink">
              {kind === "email" ? "Send by email" : kind === "whatsapp" ? "Send on WhatsApp" : "Copy client link"}
            </h3>
            <p className="text-xs text-muted">{kind === "email" ? "This is the email the client gets." : "Check these before you send."}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-[#4d5a54] hover:text-ink">
            ×
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto p-4 text-[13px]">
          {checks.length > 0 ? (
            <div className={alertInfo}>
              <strong className="block">Check before sending</strong>
              <ul className="mt-1 list-disc pl-5">
                {checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className={alertError}>
              {error}
            </p>
          ) : null}
          {loading ? <p role="status" className="text-muted">Preparing the email…</p> : null}
          {email ? (
            <dl className="flex flex-col gap-2.5">
              <div>
                <dt className={field}>To</dt>
                <dd className="break-all text-ink">{email.to}</dd>
              </div>
              <div>
                <dt className={field}>From</dt>
                <dd className="text-ink">
                  {email.fromName}
                  {email.replyTo ? <span className="text-muted"> · replies go to {email.replyTo}</span> : null}
                </dd>
              </div>
              <div>
                <dt className={field}>Subject</dt>
                <dd className="text-ink">{email.subject}</dd>
              </div>
              <div>
                <dt className={field}>Message</dt>
                <dd className="whitespace-pre-line rounded-lg bg-[#f6f4ef] p-3 text-ink">{email.text}</dd>
              </div>
              <div>
                <dt className={field}>Client link</dt>
                <dd className="break-all text-ink">{email.url}</dd>
              </div>
              <p className="text-xs text-muted">To change the message, edit Message to client above and save.</p>
            </dl>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">
          <button type="button" onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={onSend} disabled={pending || loading || !!error} className={btnPrimary} autoFocus>
            {checks.length > 0 ? label.anyway : label.plain}
          </button>
        </div>
      </div>
    </div>
  );
}
