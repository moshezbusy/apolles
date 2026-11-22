import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { alertError, alertInfo, sectionTitle } from "@/components/ui";
import { aiSearchEnabled } from "@/server/ai/config";
import { authorizeReturnPath, checkAuthorizeRequest, consentFields, hitAuthorizeLimit } from "@/server/ai/oauth";
import { hasOpenConnectWindow } from "@/server/ai/tokens";
import { requireAgent } from "@/server/auth/guards";
import { getClientIp } from "@/server/client-ip";
import { ConsentForm } from "./consent-form";
import { INVALID_LINK_COPY, NO_WINDOW_COPY, TOO_MANY_COPY, WARNING_COPY } from "./copy";

export const metadata: Metadata = { title: "Connect an assistant · Apolles", robots: { index: false, follow: false } };

const CAN = ["Search hotels and rates", "Open a result in Apolles to book"];
const CANNOT = ["Book, cancel or issue vouchers", "See guests or your balance"];

function Problem({ text }: { text: string }) {
  return (
    <AuthShell eyebrow="AI assistant" title="Connect an assistant">
      <p role="alert" className={alertError}>
        {text}
      </p>
    </AuthShell>
  );
}

// OAuth authorize (plan 11, design §4.1, mockup 20): an agent lets Claude or ChatGPT search
// for them. Needs a full agent session (a signed-out agent comes back here after sign-in).
// Allow is offered only inside a connect window this session opened in the AI assistants tab.
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!aiSearchEnabled()) notFound();
  const params = await searchParams;
  const agent = await requireAgent({ returnTo: authorizeReturnPath(params) });
  if (!(await hitAuthorizeLimit(getClientIp(await headers())))) return <Problem text={TOO_MANY_COPY} />;

  const check = await checkAuthorizeRequest(params);
  if (check.kind === "invalid_link") return <Problem text={INVALID_LINK_COPY} />;
  if (check.kind === "error") redirect(check.redirectTo);

  const { assistant, request } = check;
  const windowOpen = await hasOpenConnectWindow(agent.userId, agent.sessionId);
  return (
    <AuthShell
      eyebrow="AI assistant"
      title={`Connect ${assistant} to Apolles`}
      subtitle={`${assistant} wants to search hotels and rates for you.`}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className={sectionTitle}>{assistant} can</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink">
            {CAN.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="font-bold text-brand">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className={sectionTitle}>{assistant} can&apos;t</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink">
            {CANNOT.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="font-bold text-[#8a3f32]">
                  ✕
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p role="note" className={`mt-5 ${alertInfo}`}>
        {windowOpen ? WARNING_COPY : NO_WINDOW_COPY}
      </p>
      {windowOpen ? (
        <div className="mt-5">
          <ConsentForm fields={consentFields(request)} />
        </div>
      ) : null}
    </AuthShell>
  );
}
