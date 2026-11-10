"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { formatUsd, parseUsdToCents } from "@/lib/money";
import { requireAdmin } from "@/server/auth/guards";
import {
  AGENCY_REF_AS_TRANSFER_REF,
  confirmBankTopup,
  recordAdjustment,
  recordPayout,
} from "@/server/admin/money";
import {
  AgencyNotFound,
  IdempotencyKeyConflict,
  InsufficientFunds,
  TopupRefConflict,
} from "@/server/wallet/errors";
import type { WalletFormState } from "./form-state";

// Posted from the confirm step of the wallet page forms. Each action checks the admin session
// itself, and the service re-validates every value: nothing from the browser is trusted.
// Amounts arrive as the USD text the admin typed and are turned into cents here.

const WALLET_PAGE = "/admin/agencies/[id]/wallet";

const TOPUP_INVALID =
  "Check the form: amount in USD (e.g. 1,000.00), bank transfer reference (1–100 characters), and the date the money was received (from 2020-01-01, not in the future).";
const PAYOUT_INVALID = "Check the form: amount in USD (e.g. 250.00) and a note (1–500 characters).";
const ADJUST_INVALID =
  "Check the form: a non-zero amount in USD (e.g. 12.50 or -12.50) and a reason of at least 5 characters.";
const AMOUNT_INVALID = "Enter the amount in USD, e.g. 1,000.00 (at most 2 decimals).";
const SIGNED_AMOUNT_INVALID = "Enter a non-zero amount in USD, e.g. 12.50 or -12.50 (at most 2 decimals).";
const NOT_ENOUGH = "Not enough available balance.";
const FORM_USED = "This form was already used for a different entry. Reload the page and try again.";

const agencyId = z.string().min(1).max(100);
const shortText = z.string().max(1000);

const topupFields = z
  .object({ agencyId, amount: shortText, bankTransferRef: shortText, receivedOn: shortText })
  .strict();
const payoutFields = z
  .object({ agencyId, amount: shortText, note: shortText, idempotencyKey: z.uuid() })
  .strict();
const adjustFields = z
  .object({ agencyId, amount: shortText, reason: shortText, idempotencyKey: z.uuid() })
  .strict();

const error = (message: string): WalletFormState => ({ status: "error", message });

// Known outcomes become a message; anything else is a real failure and is rethrown.
function toState(caught: unknown, invalidMessage: string): WalletFormState {
  if (caught instanceof ZodError) return error(invalidMessage);
  if (caught instanceof InsufficientFunds) return error(NOT_ENOUGH);
  if (caught instanceof TopupRefConflict) return error(caught.message);
  if (caught instanceof IdempotencyKeyConflict) return error(FORM_USED);
  if (caught instanceof AgencyNotFound) return error("Agency not found.");
  throw caught;
}

export async function confirmTopupAction(
  _previous: WalletFormState,
  formData: FormData,
): Promise<WalletFormState> {
  const { userId } = await requireAdmin();

  // Only the known fields are read (the form also carries Next.js internals).
  const fields = topupFields.safeParse({
    agencyId: formData.get("agencyId"),
    amount: formData.get("amount"),
    bankTransferRef: formData.get("bankTransferRef"),
    receivedOn: formData.get("receivedOn"),
  });
  if (!fields.success) return error(TOPUP_INVALID);
  const amountCents = parseUsdToCents(fields.data.amount);
  if (amountCents === null) return error(AMOUNT_INVALID);

  try {
    const { alreadyRecorded } = await confirmBankTopup(userId, {
      agencyId: fields.data.agencyId,
      amountCents,
      bankTransferRef: fields.data.bankTransferRef,
      receivedOn: fields.data.receivedOn,
    });
    if (alreadyRecorded) {
      return { status: "info", message: "This bank transfer was already recorded. Nothing was added." };
    }
    return { status: "success", message: `Top-up of ${formatUsd(amountCents)} recorded.` };
  } catch (caught) {
    // The agency's own APL- reference typed as the bank's: say exactly that (M2).
    if (caught instanceof ZodError && caught.issues.some((i) => i.message === AGENCY_REF_AS_TRANSFER_REF)) {
      return error(AGENCY_REF_AS_TRANSFER_REF);
    }
    return toState(caught, TOPUP_INVALID);
  } finally {
    revalidatePath(WALLET_PAGE, "page");
  }
}

export async function recordPayoutAction(
  _previous: WalletFormState,
  formData: FormData,
): Promise<WalletFormState> {
  const { userId } = await requireAdmin();

  const fields = payoutFields.safeParse({
    agencyId: formData.get("agencyId"),
    amount: formData.get("amount"),
    note: formData.get("note"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!fields.success) return error(PAYOUT_INVALID);
  const amountCents = parseUsdToCents(fields.data.amount);
  if (amountCents === null) return error(AMOUNT_INVALID);

  try {
    const { alreadyRecorded } = await recordPayout(userId, {
      agencyId: fields.data.agencyId,
      amountCents,
      note: fields.data.note,
      idempotencyKey: fields.data.idempotencyKey,
    });
    if (alreadyRecorded) {
      return { status: "info", message: "This payout was already recorded. Nothing was changed." };
    }
    return { status: "success", message: `Payout of ${formatUsd(amountCents)} recorded.` };
  } catch (caught) {
    return toState(caught, PAYOUT_INVALID);
  } finally {
    revalidatePath(WALLET_PAGE, "page");
  }
}

export async function recordAdjustmentAction(
  _previous: WalletFormState,
  formData: FormData,
): Promise<WalletFormState> {
  const { userId } = await requireAdmin();

  const fields = adjustFields.safeParse({
    agencyId: formData.get("agencyId"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!fields.success) return error(ADJUST_INVALID);
  const amountCents = parseUsdToCents(fields.data.amount, { allowNegative: true });
  if (amountCents === null) return error(SIGNED_AMOUNT_INVALID);

  try {
    const { alreadyRecorded } = await recordAdjustment(userId, {
      agencyId: fields.data.agencyId,
      amountCents,
      reason: fields.data.reason,
      idempotencyKey: fields.data.idempotencyKey,
    });
    if (alreadyRecorded) {
      return { status: "info", message: "This adjustment was already recorded. Nothing was changed." };
    }
    return { status: "success", message: `Adjustment of ${formatUsd(amountCents)} recorded.` };
  } catch (caught) {
    return toState(caught, ADJUST_INVALID);
  } finally {
    revalidatePath(WALLET_PAGE, "page");
  }
}
