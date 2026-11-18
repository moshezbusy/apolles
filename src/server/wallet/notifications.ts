import { z } from "zod";
import { formatUsd } from "@/lib/money";
import { getBankDetails } from "@/server/bank-details";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { LOW_BALANCE_CENTS, balanceUnderLock, getBalance } from "@/server/wallet/ledger";

// Wallet emails to the agency (mockup 23): #18 top-up received, #19 balance low (once per drop
// under USD 500). To the agency's agents (phase 1: one agent per agency).

export { LOW_BALANCE_CENTS };

function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  if (!parsed.success) throw new Error("APP_URL is not set to a valid http(s) URL");
  return parsed.data.replace(/\/+$/, "");
}

async function agentsOf(agencyId: string): Promise<{ email: string; name: string }[]> {
  return db.user.findMany({ where: { agencyId, role: "AGENT", status: "ACTIVE" }, select: { email: true, name: true }, take: 10 });
}

// Under USD 500: one email, then not again until a credit brings the balance back to USD 500 or
// more (the ledger clears the flag). Decided under the agency lock; if the email cannot go out,
// the flag is cleared again and the job retries.
export async function lowBalanceCheck(agencyId: string): Promise<void> {
  const balanceCents = await db.$transaction(async (tx) => {
    const balance = await balanceUnderLock(tx, agencyId);
    if (balance >= LOW_BALANCE_CENTS) return null;
    const claimed = await tx.agency.updateMany({ where: { id: agencyId, lowBalanceAlerted: false }, data: { lowBalanceAlerted: true } });
    return claimed.count === 0 ? null : balance;
  });
  if (balanceCents === null) return;
  try {
    const agency = await db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { bankReference: true } });
    const bank = getBankDetails()
      .map((d) => `${d.label}: ${d.value}`)
      .join("\n");
    for (const agent of await agentsOf(agencyId)) {
      await sendEmail({
        to: agent.email,
        subject: "Your Apolles balance is low",
        text: `Hello ${agent.name},\n\nYour balance is ${formatUsd(balanceCents)}. Bookings are paid from it.\n\nTop up by bank transfer:\n${bank}\nYour reference: ${agency.bankReference} (always write it on the transfer)\n\nAdd funds:\n${appUrl()}/balance\n`,
      });
    }
  } catch (error) {
    await db.agency.updateMany({ where: { id: agencyId, lowBalanceAlerted: true }, data: { lowBalanceAlerted: false } });
    throw error;
  }
}

// #18: after the admin confirms a bank transfer. The entry is read again, so a stale job sends
// nothing wrong. (The ledger itself clears the low-balance flag when the balance is back.)
export async function sendTopupEmail(entryId: string): Promise<void> {
  const entry = await db.ledgerEntry.findUnique({ where: { id: entryId }, select: { agencyId: true, type: true, amountCents: true } });
  if (!entry || entry.type !== "TOPUP_BANK") return;
  const { balanceCents } = await getBalance(entry.agencyId);
  for (const agent of await agentsOf(entry.agencyId)) {
    await sendEmail({
      to: agent.email,
      subject: `${formatUsd(entry.amountCents)} added to your Apolles balance`,
      text: `Hello ${agent.name},\n\n${formatUsd(entry.amountCents)} from your bank transfer was added to your balance.\nYour balance now: ${formatUsd(balanceCents)}\n\nView balance:\n${appUrl()}/balance\n`,
    });
  }
}
