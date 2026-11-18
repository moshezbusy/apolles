import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { isCountryCode } from "@/lib/countries";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";

// An agency's clients and their travel companions (mockup 18, plan 5a). Every function takes the
// agencyId from the caller's session (requireAgent), never from the request: a client of another
// agency is never found, changed or listed (no IDOR). The audit log records which fields changed,
// never the client's personal data.

export const CLIENT_PAGE_SIZE = 50;

// Letters, spaces and normal punctuation; no control or invisible formatting characters (NUL,
// line breaks, right-to-left overrides).
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));

const name = plainText(60).pipe(z.string().min(1));

// "+972 50-123-4567", "(03) 555 1234": 7 to 15 digits, as on the agency profile.
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^\+?[0-9 \-()]+$/)
  .refine((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
  });

export const clientInput = z
  .object({
    firstName: name,
    lastName: name,
    phone,
    email: z.union([z.literal(""), z.string().trim().max(254).pipe(z.email())]),
    nationality: z.string().trim().refine(isCountryCode),
    // Line breaks are allowed in notes; other control characters are not. A browser sends a
    // line break as CRLF, so CR is turned into LF first.
    notes: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .pipe(
        z
          .string()
          .trim()
          .max(1000)
          .refine((value) => !/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/u.test(value)),
      ),
  })
  .strict();

export type ClientInput = z.input<typeof clientInput>;

export const companionInput = z
  .object({
    firstName: name,
    lastName: name,
    relation: plainText(40),
    // Empty for an adult; a whole number 0 to 17 for a child.
    childAge: z.union([z.literal(""), z.string().trim().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(0).max(17))]),
  })
  .strict();

export type CompanionInput = z.input<typeof companionInput>;

export type Result = { ok: true; id: string } | { ok: false };

// A client's travel companions; the details panel always shows all of them.
export const MAX_COMPANIONS = 20;

// Digits only, without a leading "00" or "0", so "050-123 4567" and "+972 50 1234567" can both be
// found by typing part of the number.
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export type ClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  nationality: string;
  travelers: number;
  updatedAt: Date;
};

export type ClientPage = { clients: ClientRow[]; total: number; nextCursor: string | null };

// Newest change first, 50 per page. The cursor is the last client's id.
export async function listClients(
  agencyId: string,
  options: { q?: string | undefined; cursor?: string | undefined },
): Promise<ClientPage> {
  const where = searchWhere(agencyId, options.q ?? "");
  // The cursor must be one of the agency's own clients; any other id starts from the first page.
  const cursor = options.cursor
    ? ((await db.client.findFirst({ where: { id: options.cursor, agencyId }, select: { id: true } }))?.id ?? null)
    : null;
  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: CLIENT_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationality: true,
        updatedAt: true,
        _count: { select: { companions: true } },
      },
    }),
    db.client.count({ where }),
  ]);
  const page = rows.slice(0, CLIENT_PAGE_SIZE);
  return {
    clients: page.map(({ _count, ...row }) => ({ ...row, travelers: 1 + _count.companions })),
    total,
    nextCursor: rows.length > CLIENT_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

function searchWhere(agencyId: string, rawQuery: string): Prisma.ClientWhereInput {
  const q = rawQuery.trim().slice(0, 100);
  if (!q) return { agencyId };
  const words = q.split(/\s+/).filter(Boolean);
  const or: Prisma.ClientWhereInput[] = [
    // Every word must match the first name, the last name or the email.
    {
      AND: words.map((word) => ({
        OR: [
          { firstName: { contains: word, mode: "insensitive" } },
          { lastName: { contains: word, mode: "insensitive" } },
          { email: { contains: word.toLowerCase() } },
        ],
      })),
    },
  ];
  const digits = phoneDigits(q);
  if (/^[+0-9 \-()]+$/.test(q) && digits.length >= 3) or.push({ phoneDigits: { contains: digits } });
  return { agencyId, OR: or };
}

export type ClientDetail = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  nationality: string;
  notes: string;
  createdAt: Date;
  companions: { id: string; firstName: string; lastName: string; relation: string; childAge: number | null }[];
};

export async function getClient(agencyId: string, clientId: string): Promise<ClientDetail | null> {
  return db.client.findFirst({
    where: { id: clientId, agencyId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      nationality: true,
      notes: true,
      createdAt: true,
      companions: {
        orderBy: { position: "asc" },
        select: { id: true, firstName: true, lastName: true, relation: true, childAge: true },
      },
    },
  });
}

function toRow(input: z.output<typeof clientInput>) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email ? normalizeEmail(input.email) : null,
    phone: input.phone,
    phoneDigits: phoneDigits(input.phone),
    nationality: input.nationality,
    notes: input.notes,
  };
}

export async function createClient(actorUserId: string, agencyId: string, rawInput: ClientInput): Promise<Result> {
  const parsed = clientInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false };
  const id = await db.$transaction(async (tx) => {
    const created = await tx.client.create({ data: { agencyId, ...toRow(parsed.data) }, select: { id: true } });
    await audit(actorUserId, "client.create", "Client", created.id, undefined, undefined, tx);
    return created.id;
  });
  return { ok: true, id };
}

export async function updateClient(
  actorUserId: string,
  agencyId: string,
  clientId: string,
  rawInput: ClientInput,
): Promise<Result> {
  const parsed = clientInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false };
  const next = toRow(parsed.data);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Client" WHERE id = ${clientId} AND "agencyId" = ${agencyId} FOR UPDATE`;
    if (rows.length === 0) return { ok: false } as const;
    const before = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { ...selectFields } });
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => key !== "phoneDigits" && before[key] !== next[key]);
    await tx.client.update({ where: { id: clientId }, data: next });
    await audit(actorUserId, "client.update", "Client", clientId, undefined, { changed }, tx);
    return { ok: true, id: clientId } as const;
  });
}

const selectFields = {
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  phoneDigits: true,
  nationality: true,
  notes: true,
} as const;

export async function addCompanion(
  actorUserId: string,
  agencyId: string,
  clientId: string,
  rawInput: CompanionInput,
): Promise<Result> {
  const parsed = companionInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false };
  const { childAge, ...rest } = parsed.data;
  return db.$transaction(async (tx) => {
    // Lock the client (and prove it belongs to the agency) so two adds get distinct positions.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Client" WHERE id = ${clientId} AND "agencyId" = ${agencyId} FOR UPDATE`;
    if (rows.length === 0) return { ok: false } as const;
    if ((await tx.clientCompanion.count({ where: { clientId } })) >= MAX_COMPANIONS) return { ok: false } as const;
    const last = await tx.clientCompanion.findFirst({ where: { clientId }, orderBy: { position: "desc" }, select: { position: true } });
    const created = await tx.clientCompanion.create({
      data: { clientId, ...rest, childAge: childAge === "" ? null : childAge, position: (last?.position ?? -1) + 1 },
      select: { id: true },
    });
    // The client's "last activity" moves with its companions.
    await tx.client.update({ where: { id: clientId }, data: { updatedAt: new Date() } });
    await audit(actorUserId, "client.companion.add", "Client", clientId, undefined, { companionId: created.id }, tx);
    return { ok: true, id: created.id } as const;
  });
}

export async function removeCompanion(actorUserId: string, agencyId: string, companionId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const companion = await tx.clientCompanion.findFirst({
      where: { id: companionId, client: { agencyId } },
      select: { id: true, clientId: true },
    });
    if (!companion) return { ok: false } as const;
    await tx.clientCompanion.delete({ where: { id: companion.id } });
    await tx.client.update({ where: { id: companion.clientId }, data: { updatedAt: new Date() } });
    await audit(actorUserId, "client.companion.remove", "Client", companion.clientId, { companionId: companion.id }, undefined, tx);
    return { ok: true, id: companion.clientId } as const;
  });
}
