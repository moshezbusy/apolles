"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { alertError, alertInfo, alertSuccess, btnPrimary, btnSecondary, inputUnsized } from "@/components/ui";
import type { SendState } from "../actions";
import { useQuoteDirty } from "./dirty";

const WHATSAPP_START = "https://wa.me/";

type Action = (quoteId: string, confirmNetPrice?: boolean) => Promise<SendState>;
type Kind = "whatsapp" | "email" | "copy";

// "Send quote" (mockup 15): WhatsApp opens the agent's own WhatsApp with the message and the link
// ready (Apolles sends nothing there); Email is sent by Apolles in the agency's name; Copy link
// copies the client link. Each one marks a draft as sent. Preview shows the client page.
// All of them read the SAVED quote: while the settings form above holds unsaved changes they are
// off. A quote that would show the client the agency's cost price (no markup saved) is sent only
// after the agent says so here.
export function SendPanel({
  quoteId,
  shareUrl,
  hasClient,
  hasEmail,
  phoneHint,
  closed,
  actions,
}: {
  quoteId: string;
  shareUrl: string | null;
  hasClient: boolean;
  hasEmail: boolean;
  // Set when the client's number cannot be made into a WhatsApp link (no country code).
  phoneHint: string | null;
  closed: boolean;
  actions: { copy: Action; whatsapp: Action; email: Action; renew: Action };
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
        <button type="button" onClick={() => whatsapp()} disabled={off || !hasClient || !!phoneHint} className={btnPrimary} title={hasClient ? "" : "Choose the client first"}>
          Send on WhatsApp
        </button>
        <button type="button" onClick={() => email()} disabled={off || !hasEmail} className={btnSecondary} title={hasEmail ? "" : "The client has no email"}>
          Send by email
        </button>
        <button type="button" onClick={() => copy()} disabled={off} className={btnSecondary}>
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
    </div>
  );
}
