import { z } from "zod";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { parseMarkup } from "@/server/quotes/pricing";
import { normalizeEmail } from "@/server/users";

// Screen 20, "Quote branding" and "Preferences": how the agency appears on its client quotes, and
// the defaults of a new quote. Every function takes the agencyId from the caller's session and
// audits the change in the same transaction. Empty = the agency's own name and phone.

export type QuoteSettings = {
  displayName: string;
  advisorName: string;
  contactPhone: string;
  advisorEmail: string;
  defaultLanguage: "EN" | "HE";
  brandColor: string; // "" or "#rrggbb"
  defaultMessage: string;
  defaultMarkupType: "PERCENT" | "FIXED";
  defaultMarkupValue: number; // basis points (percent) or cents (fixed)
  defaultShowCancellation: boolean;
};

export type SettingsResult = { ok: true } | { ok: false; error: string };

const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));

// Same rule as the agency phone: digits, spaces, dashes, brackets, an optional +; 7 to 15 digits.
const phone = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9 \-()]+$/)
    .refine((value) => {
      const digits = value.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15;
    }),
]);

export const quoteBrandingInput = z
  .object({
    displayName: line(80),
    advisorName: line(80),
    contactPhone: phone,
    advisorEmail: z.union([z.literal(""), z.string().trim().max(254).pipe(z.email())]),
    defaultLanguage: z.enum(["EN", "HE"]),
    // Only #rrggbb: the value goes into the client page's styles, so nothing else may pass.
    brandColor: z.union([z.literal(""), z.string().trim().regex(/^#[0-9a-fA-F]{6}$/)]),
    defaultMessage: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .pipe(z.string().trim().max(1000).refine((value) => !/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/u.test(value))),
  })
  .strict();

export type QuoteBrandingInput = z.input<typeof quoteBrandingInput>;

const SELECT = {
  quoteDisplayName: true,
  quoteAdvisorName: true,
  quoteContactPhone: true,
  quoteAdvisorEmail: true,
  quoteBrandColor: true,
  defaultQuoteLanguage: true,
  defaultQuoteMessage: true,
  defaultMarkupType: true,
  defaultMarkupValue: true,
  defaultShowCancellation: true,
} as const;

export async function getQuoteSettings(agencyId: string): Promise<QuoteSettings | null> {
  const a = await db.agency.findUnique({ where: { id: agencyId }, select: SELECT });
  if (!a) return null;
  return {
    displayName: a.quoteDisplayName ?? "",
    advisorName: a.quoteAdvisorName ?? "",
    contactPhone: a.quoteContactPhone ?? "",
    advisorEmail: a.quoteAdvisorEmail ?? "",
    defaultLanguage: a.defaultQuoteLanguage,
    brandColor: a.quoteBrandColor ?? "",
    defaultMessage: a.defaultQuoteMessage,
    defaultMarkupType: a.defaultMarkupType,
    defaultMarkupValue: a.defaultMarkupValue,
    defaultShowCancellation: a.defaultShowCancellation,
  };
}

const BRANDING_ERROR = "Check the fields: a phone of 7 to 15 digits, a valid email, and a color like #1f5e4a.";

// rawInput is checked here (Zod, unknown fields refused), so a form's strings can be passed as is.
export async function updateQuoteBranding(actorUserId: string, agencyId: string, rawInput: QuoteBrandingInput | Record<string, string>): Promise<SettingsResult> {
  const parsed = quoteBrandingInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: BRANDING_ERROR };
  const v = parsed.data;
  const data = {
    quoteDisplayName: v.displayName || null,
    quoteAdvisorName: v.advisorName || null,
    quoteContactPhone: v.contactPhone || null,
    quoteAdvisorEmail: v.advisorEmail ? normalizeEmail(v.advisorEmail) : null,
    quoteBrandColor: v.brandColor ? v.brandColor.toLowerCase() : null,
    defaultQuoteLanguage: v.defaultLanguage,
    defaultQuoteMessage: v.defaultMessage,
  };
  await db.$transaction(async (tx) => {
    await tx.agency.update({ where: { id: agencyId }, data });
    // Which fields changed is enough; the values (names, phone, email) stay out of the log.
    await audit(actorUserId, "agency.quote-branding.update", "Agency", agencyId, undefined, { fields: Object.keys(data) }, tx);
  });
  return { ok: true };
}

const defaultsInput = z
  .object({
    markupType: z.string().max(10),
    markupValue: z.string().max(20),
    showCancellation: z.boolean(),
  })
  .strict();

export async function updateQuoteDefaults(
  actorUserId: string,
  agencyId: string,
  rawInput: z.input<typeof defaultsInput>,
): Promise<SettingsResult> {
  const parsed = defaultsInput.safeParse(rawInput);
  const markup = parsed.success ? parseMarkup(parsed.data.markupType, parsed.data.markupValue) : null;
  if (!parsed.success || !markup) return { ok: false, error: "Enter a markup of 0 to 100% or a fixed USD amount up to 10,000, with up to 2 decimals." };
  const data = { defaultMarkupType: markup.markupType, defaultMarkupValue: markup.markupValue, defaultShowCancellation: parsed.data.showCancellation };
  await db.$transaction(async (tx) => {
    await tx.agency.update({ where: { id: agencyId }, data });
    await audit(actorUserId, "agency.quote-defaults.update", "Agency", agencyId, undefined, data, tx);
  });
  return { ok: true };
}
