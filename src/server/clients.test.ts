import { beforeEach, describe, expect, it } from "vitest";
import {
  addCompanion,
  createClient,
  getClient,
  listClients,
  phoneDigits,
  removeCompanion,
  updateClient,
} from "@/server/clients";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;

const DANIEL = {
  firstName: "Daniel",
  lastName: "Levy",
  phone: "+972 50 123 4567",
  email: "Daniel.Levy@Email.com",
  nationality: "IL",
  notes: "Prefers adults-only resorts.",
};

beforeEach(async () => {
  await resetTestDb();
  agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
  agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
  agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
  agentB = (await createUser({ email: "b@other.example", name: "Bob", role: "AGENT", agencyId: agencyB })).id;
});

describe("phoneDigits", () => {
  it("keeps digits only and drops a leading +, 00 or 0", () => {
    expect(phoneDigits("+972 50-123 4567")).toBe("972501234567");
    expect(phoneDigits("00972 (50) 123 4567")).toBe("972501234567");
    expect(phoneDigits("050-123-4567")).toBe("501234567");
  });
});

describe("createClient", () => {
  it("saves the client for the agency, email lowercase, and audits without personal data", async () => {
    const result = await createClient(agentA, agencyA, DANIEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db.client.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({
      agencyId: agencyA,
      firstName: "Daniel",
      lastName: "Levy",
      email: "daniel.levy@email.com",
      phone: "+972 50 123 4567",
      phoneDigits: "972501234567",
      nationality: "IL",
    });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "client.create" } });
    expect(log).toMatchObject({ actorUserId: agentA, targetType: "Client", targetId: result.id });
    expect(JSON.stringify(log)).not.toContain("Levy");
    expect(JSON.stringify(log)).not.toContain("4567");
  });

  it("email is optional", async () => {
    const result = await createClient(agentA, agencyA, { ...DANIEL, email: "" });
    expect(result.ok).toBe(true);
  });

  it("refuses bad input and saves nothing", async () => {
    for (const bad of [
      { ...DANIEL, firstName: "" },
      { ...DANIEL, lastName: "x".repeat(61) },
      { ...DANIEL, phone: "12" },
      { ...DANIEL, email: "not-an-email" },
      { ...DANIEL, nationality: "XX" },
      { ...DANIEL, notes: "n".repeat(1001) },
      { ...DANIEL, firstName: "Dan‮iel" },
    ]) {
      const result = await createClient(agentA, agencyA, bad);
      expect(result.ok).toBe(false);
    }
    expect(await db.client.count()).toBe(0);
  });

  it("refuses unknown fields (agencyId cannot be smuggled in)", async () => {
    const result = await createClient(agentA, agencyA, { ...DANIEL, agencyId: agencyB } as never);
    expect(result.ok).toBe(false);
    expect(await db.client.count()).toBe(0);
  });
});

describe("listClients", () => {
  beforeEach(async () => {
    await createClient(agentA, agencyA, DANIEL);
    await createClient(agentA, agencyA, { ...DANIEL, firstName: "Maya", lastName: "Cohen", email: "maya@example.com", phone: "052-444-1180" });
    await createClient(agentB, agencyB, { ...DANIEL, firstName: "Secret", lastName: "Person", email: "s@other.example" });
  });

  it("lists only the agency's own clients, newest change first, with the traveler count", async () => {
    const page = await listClients(agencyA, {});
    expect(page.clients.map((c) => c.firstName)).toEqual(["Maya", "Daniel"]);
    expect(page.clients[0]).toMatchObject({ travelers: 1 });
    expect(page.total).toBe(2);
  });

  it("searches by name, email and phone (spaces, dashes and a leading 0 ignored)", async () => {
    expect((await listClients(agencyA, { q: "levy" })).clients.map((c) => c.firstName)).toEqual(["Daniel"]);
    expect((await listClients(agencyA, { q: "MAYA@EX" })).clients.map((c) => c.firstName)).toEqual(["Maya"]);
    expect((await listClients(agencyA, { q: "0524441180" })).clients.map((c) => c.firstName)).toEqual(["Maya"]);
    expect((await listClients(agencyA, { q: "50 123 45" })).clients.map((c) => c.firstName)).toEqual(["Daniel"]);
    expect((await listClients(agencyA, { q: "Secret" })).clients).toEqual([]);
  });

  it("pages 50 at a time with a cursor", async () => {
    for (let i = 0; i < 55; i++) {
      await createClient(agentA, agencyA, { ...DANIEL, firstName: `C${i}` });
    }
    const first = await listClients(agencyA, {});
    expect(first.clients).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await listClients(agencyA, { cursor: first.nextCursor ?? undefined });
    expect(second.clients).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.clients, ...second.clients].map((c) => c.id));
    expect(ids.size).toBe(57);
  });
});

describe("getClient, updateClient and companions", () => {
  let clientId: string;
  beforeEach(async () => {
    const result = await createClient(agentA, agencyA, DANIEL);
    if (!result.ok) throw new Error("setup");
    clientId = result.id;
  });

  it("another agency never sees, edits or adds to the client", async () => {
    expect(await getClient(agencyB, clientId)).toBeNull();
    expect((await updateClient(agentB, agencyB, clientId, { ...DANIEL, firstName: "Hacked" })).ok).toBe(false);
    expect((await addCompanion(agentB, agencyB, clientId, { firstName: "X", lastName: "Y", relation: "", childAge: "" })).ok).toBe(false);
    expect(await getClient(agencyA, clientId)).toMatchObject({ firstName: "Daniel", companions: [] });
  });

  it("updates the client and audits the names of the changed fields only", async () => {
    const result = await updateClient(agentA, agencyA, clientId, { ...DANIEL, notes: "Anniversary in October." });
    expect(result.ok).toBe(true);
    expect(await getClient(agencyA, clientId)).toMatchObject({ notes: "Anniversary in October." });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "client.update" } });
    expect(log.after).toEqual({ changed: ["notes"] });
  });

  it("adds an adult and a child companion in order, and removes one", async () => {
    expect((await addCompanion(agentA, agencyA, clientId, { firstName: "Maya", lastName: "Levy", relation: "Spouse", childAge: "" })).ok).toBe(true);
    expect((await addCompanion(agentA, agencyA, clientId, { firstName: "Noa", lastName: "Levy", relation: "Daughter", childAge: "7" })).ok).toBe(true);
    const client = await getClient(agencyA, clientId);
    expect(client?.companions.map((c) => [c.firstName, c.relation, c.childAge])).toEqual([
      ["Maya", "Spouse", null],
      ["Noa", "Daughter", 7],
    ]);
    expect((await listClients(agencyA, {})).clients[0]).toMatchObject({ travelers: 3 });

    const noa = client?.companions[1]?.id ?? "";
    expect((await removeCompanion(agentB, agencyB, noa)).ok).toBe(false);
    expect((await removeCompanion(agentA, agencyA, noa)).ok).toBe(true);
    expect((await getClient(agencyA, clientId))?.companions.map((c) => c.firstName)).toEqual(["Maya"]);
  });

  it("refuses a child age outside 0 to 17", async () => {
    expect((await addCompanion(agentA, agencyA, clientId, { firstName: "A", lastName: "B", relation: "", childAge: "18" })).ok).toBe(false);
    expect((await addCompanion(agentA, agencyA, clientId, { firstName: "A", lastName: "B", relation: "", childAge: "-1" })).ok).toBe(false);
  });
});
