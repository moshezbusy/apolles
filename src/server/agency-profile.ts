import { createHash } from "node:crypto";
import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { readImageInfo } from "@/lib/image-info";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";

// The agency profile the agent edits on /settings: name, business email, phone, country and
// logo (spec 7א: the voucher shows them). Every function takes the agencyId from the
// caller's session (requireAgent), never from the request, and audits each change in the
// same transaction as the change.

export const LOGO_MAX_BYTES = 512_000;
const LOGO_MIN_WIDTH = 300;
const LOGO_MAX_SIDE = 4_000;

export const LOGO_RULE_COPY = "PNG or JPEG, at least 300px wide, up to 500 KB.";

// "+972 50-123-4567", "(03) 555 1234": digits with plain spaces, dashes and brackets, an
// optional leading +, 7 to 15 digits in total (the E.164 maximum). No tabs or line breaks.
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^\+?[0-9 \-()]+$/)
  .refine((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
  });

export const agencyProfileInput = z
  .object({
    // No control or invisible formatting characters (NUL, line breaks, right-to-left
    // overrides): the name is shown in the admin list and printed on vouchers.
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value)),
    email: z.string().trim().max(254).pipe(z.email()),
    phone,
    country: z.string().trim().refine(isCountryCode),
  })
  .strict();

export type AgencyProfileInput = z.input<typeof agencyProfileInput>;

export type AgencyProfile = {
  name: string;
  email: string | null;
  phone: string | null;
  country: string;
  bankReference: string;
  hasLogo: boolean;
  logoSha256: string | null;
};

export async function getAgencyProfile(agencyId: string): Promise<AgencyProfile | null> {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      email: true,
      phone: true,
      country: true,
      bankReference: true,
      logo: { select: { sha256: true } },
    },
  });
  if (!agency) return null;
  const { logo, ...rest } = agency;
  return { ...rest, hasLogo: logo !== null, logoSha256: logo?.sha256 ?? null };
}

// Throws (ZodError) on invalid input; nothing changes then.
export async function updateAgencyProfile(
  actorUserId: string,
  agencyId: string,
  rawInput: AgencyProfileInput,
): Promise<void> {
  const input = agencyProfileInput.parse(rawInput);
  const after = { ...input, email: normalizeEmail(input.email) };

  await db.$transaction(async (tx) => {
    // Lock the row so two saves at the same moment are recorded one after the other, each
    // with the right "before" in the audit log.
    await tx.$queryRaw`SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
    const before = await tx.agency.findUniqueOrThrow({
      where: { id: agencyId },
      select: { name: true, email: true, phone: true, country: true },
    });
    await tx.agency.update({ where: { id: agencyId }, data: after });
    await audit(actorUserId, "agency.profile.update", "Agency", agencyId, before, after, tx);
  });
}

export type SetLogoResult = { ok: true } | { ok: false; error: string };

// The type and size are read from the file's own bytes (never its name or the browser's
// claim), so SVG, HTML and anything else that is not a real PNG or JPEG is refused.
export async function setAgencyLogo(
  actorUserId: string,
  agencyId: string,
  bytes: Uint8Array,
): Promise<SetLogoResult> {
  if (bytes.length === 0) return { ok: false, error: "Choose an image file." };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: `The file is too large. ${LOGO_RULE_COPY}` };
  const info = readImageInfo(bytes);
  if (!info) return { ok: false, error: `This file is not a PNG or JPEG image. ${LOGO_RULE_COPY}` };
  if (info.width < LOGO_MIN_WIDTH || info.width > LOGO_MAX_SIDE || info.height > LOGO_MAX_SIDE) {
    return { ok: false, error: `The image is ${info.width}×${info.height}px. ${LOGO_RULE_COPY} At most 4000px per side.` };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const meta = { sha256, sizeBytes: bytes.length, width: info.width, height: info.height, mimeType: info.type };
  const data = Uint8Array.from(bytes);

  await db.$transaction(async (tx) => {
    await tx.agencyLogo.upsert({
      where: { agencyId },
      create: { agencyId, data, ...meta },
      update: { data, ...meta },
    });
    await audit(actorUserId, "agency.logo.set", "Agency", agencyId, undefined, meta, tx);
  });
  return { ok: true };
}

export async function removeAgencyLogo(actorUserId: string, agencyId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const removed = await tx.agencyLogo.deleteMany({ where: { agencyId } });
    if (removed.count > 0) await audit(actorUserId, "agency.logo.remove", "Agency", agencyId, undefined, undefined, tx);
  });
}

export async function getAgencyLogo(agencyId: string) {
  return db.agencyLogo.findUnique({
    where: { agencyId },
    select: { mimeType: true, data: true, sizeBytes: true, width: true, height: true, sha256: true },
  });
}
