"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { alertError, alertSuccess, btnPrimary, btnSecondary, input } from "@/components/ui";
import type { SendState } from "../actions";

type Action = (quoteId: string) => Promise<SendState>;

// "Send quote" (mockup 15): WhatsApp opens the agent's own WhatsApp with the message and the link
// ready (Apolles sends nothing there); Email is sent by Apolles in the agency's name; Copy link
// copies the client link. Each one marks a draft as sent. Preview shows the client page.
export function SendPanel({
  quoteId,
  shareUrl,
  hasClient,
  hasEmail,
  actions,
}: {
  quoteId: string;
  shareUrl: string | null;
  hasClient: boolean;
  hasEmail: boolean;
  actions: { copy: Action; whatsapp: Action; email: Action };
}) {
  const [url, setUrl] = useState(shareUrl);
  const [state, setState] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function whatsapp() {
    // Opened now, while the click still counts as the agent's, then pointed at WhatsApp.
    const tab = window.open("", "_blank");
    start(async () => {
      const result = await actions.whatsapp(quoteId);
      if (!result.ok || !result.url) {
        tab?.close();
        setState({ kind: "error", text: result.ok ? "Could not open WhatsApp." : result.error });
        return;
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = result.url;
      } else window.location.href = result.url;
      setState({ kind: "ok", text: "WhatsApp opened with the message. The quote is marked as sent." });
    });
  }

  function copy() {
    start(async () => {
      const result = await actions.copy(quoteId);
      if (!result.ok || !result.url) {
        setState({ kind: "error", text: result.ok ? "Could not make the link." : result.error });
        return;
      }
      setUrl(result.url);
      try {
        await navigator.clipboard.writeText(result.url);
        setState({ kind: "ok", text: "Link copied. The quote is marked as sent." });
      } catch {
        setState({ kind: "ok", text: "Link ready below. Copy it by hand." });
      }
    });
  }

  function email() {
    start(async () => {
      const result = await actions.email(quoteId);
      setState(result.ok ? { kind: "ok", text: result.message ?? "Email sent." } : { kind: "error", text: result.error });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={whatsapp} disabled={pending || !hasClient} className={btnPrimary} title={hasClient ? "" : "Choose the client first"}>
          Send on WhatsApp
        </button>
        <button type="button" onClick={email} disabled={pending || !hasEmail} className={btnSecondary} title={hasEmail ? "" : "The client has no email"}>
          Send by email
        </button>
        <button type="button" onClick={copy} disabled={pending} className={btnSecondary}>
          Copy client link
        </button>
        <Link href={`/quotes/${quoteId}/preview`} className={btnSecondary}>
          Preview
        </Link>
      </div>
      {url ? <input readOnly value={url} aria-label="Client link" className={`${input} text-xs`} onFocus={(e) => e.currentTarget.select()} /> : null}
      {state ? (
        <p role={state.kind === "error" ? "alert" : "status"} className={state.kind === "error" ? alertError : alertSuccess}>
          {state.text}
        </p>
      ) : null}
      <p className="text-xs text-muted">Copying the link, opening WhatsApp or sending the email marks the quote as sent.</p>
    </div>
  );
}
