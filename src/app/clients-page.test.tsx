import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";
import { requireAgent } from "@/server/auth/guards";
import { addCompanion, createClient, getClient } from "@/server/clients";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

const DANIEL = { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "daniel@example.com", nationality: "IL", notes: "Anniversary in October." };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;
let daniel: string;

function signInAs(agencyId: string, userId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId });
}

async function render(params: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./(agent)/clients/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

beforeEach(async () => {
  await resetTestDb();
  vi.mocked(requireAgent).mockReset();
  agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
  agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
  agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
  agentB = (await createUser({ email: "b@other.example", name: "Bob", role: "AGENT", agencyId: agencyB })).id;
  const created = await createClient(agentA, agencyA, DANIEL);
  if (!created.ok) throw new Error("setup");
  daniel = created.id;
  await addCompanion(agentA, agencyA, daniel, { firstName: "Noa", lastName: "Levy", relation: "Daughter", childAge: "7" });
  await createClient(agentB, agencyB, { ...DANIEL, firstName: "Secret", lastName: "Person" });
  signInAs(agencyA, agentA);
});

describe("/clients page", () => {
  it("checks the session and lists only the agency's clients, with the first one open", async () => {
    const html = await render();
    expect(requireAgent).toHaveBeenCalled();
    expect(html).toContain("Clients");
    expect(html).toContain("Daniel Levy");
    expect(html).toContain("1 client");
    expect(html).not.toContain("Secret");
    // Detail panel: details, notes and travel companions (the client is the lead traveler).
    expect(html).toContain("daniel@example.com");
    expect(html).toContain("Anniversary in October.");
    expect(html).toContain("Lead · Adult");
    expect(html).toContain("Daughter · 7 years old");
  });

  it("a phone that cannot be made into a WhatsApp number gets a hint; a local number of the agency's country does not", async () => {
    expect(await render()).not.toContain("Add the country code to this phone number");
    // The local way of the agency's country (IL): fine, it gets +972. The stored number is not rewritten.
    await db.client.update({ where: { id: daniel }, data: { phone: "050-123 4567" } });
    const local = await render();
    expect(local).not.toContain("Add the country code to this phone number");
    expect(local).toContain("050-123 4567");
    // With or without the country code? Not clear: the agent is asked to add it.
    await db.client.update({ where: { id: daniel }, data: { phone: "972 50 123 4567" } });
    expect(await render()).toContain("Add the country code to this phone number");
  });

  it("an id from another agency opens nothing of theirs", async () => {
    const other = await db.client.findFirstOrThrow({ where: { agencyId: agencyB } });
    const html = await render({ id: other.id });
    expect(html).not.toContain("Secret");
  });

  it("search with no match shows the empty message", async () => {
    const html = await render({ q: "nobody" });
    expect(html).toContain("No clients match your search.");
    expect(html).toContain("0 clients");
  });

  it("shows the add form and the edit form", async () => {
    expect(await render({ new: "1" })).toContain("Save client");
    const edit = await render({ id: daniel, edit: "1" });
    expect(edit).toContain('value="Daniel"');
    expect(edit).toMatch(/<option value="IL" selected="">Israel<\/option>/);
  });
});

describe("client actions", () => {
  it("creates a client for the session's agency and opens it", async () => {
    const { createClientAction } = await import("./(agent)/clients/actions");
    await expect(
      createClientAction(null, form({ firstName: "Maya", lastName: "Cohen", phone: "052-444-1180", email: "", nationality: "IL", notes: "", agencyId: agencyB })),
    ).rejects.toThrow(/NEXT_REDIRECT:\/clients\?id=/);
    expect(await db.client.count({ where: { agencyId: agencyA, firstName: "Maya" } })).toBe(1);
    expect(await db.client.count({ where: { agencyId: agencyB, firstName: "Maya" } })).toBe(0);
  });

  it("returns what was typed with an error on bad input", async () => {
    const { createClientAction } = await import("./(agent)/clients/actions");
    const state = await createClientAction(null, form({ firstName: "", lastName: "Cohen", phone: "1", email: "x", nationality: "IL", notes: "" }));
    expect(state?.status).toBe("error");
    expect(state && "values" in state ? state.values?.lastName : null).toBe("Cohen");
  });

  it("another agency cannot edit the client or change its companions", async () => {
    signInAs(agencyB, agentB);
    const { updateClientAction, addCompanionAction, removeCompanionAction } = await import("./(agent)/clients/actions");
    const state = await updateClientAction(null, form({ clientId: daniel, ...DANIEL, firstName: "Hacked" }));
    expect(state?.status).toBe("error");
    const added = await addCompanionAction(null, form({ clientId: daniel, firstName: "X", lastName: "Y", relation: "", childAge: "" }));
    expect(added?.status).toBe("error");
    const noa = (await getClient(agencyA, daniel))?.companions[0]?.id ?? "";
    await removeCompanionAction(form({ companionId: noa }));
    expect(await getClient(agencyA, daniel)).toMatchObject({ firstName: "Daniel", companions: [{ firstName: "Noa" }] });
  });

  it("warns before a second card with the same email or phone; saving again adds it; another agency's client does not count", async () => {
    const { createClientAction } = await import("./(agent)/clients/actions");
    const fields = { firstName: "Dani", lastName: "Levi", phone: "050 123 4567", email: "", nationality: "IL", notes: "" };
    const state = await createClientAction(null, form({ ...fields, phone: "+972 50 123 4567" }));
    expect(state).toMatchObject({ status: "error", duplicate: { id: daniel, name: "Daniel Levy" }, values: { firstName: "Dani" } });
    expect(state?.status === "error" ? state.message : "").toBe("Daniel Levy already has this email or phone. Open that client, or choose Save client again to add a new one.");
    expect(await db.client.count({ where: { agencyId: agencyA } })).toBe(1);
    await expect(createClientAction(null, form({ ...fields, phone: "+972 50 123 4567", confirmDuplicate: "1" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await db.client.count({ where: { agencyId: agencyA } })).toBe(2);
    // The same email: warned too (case does not matter).
    expect(await createClientAction(null, form({ ...fields, phone: "+1 555 000 1111", email: "DANIEL@example.com" }))).toMatchObject({ duplicate: { id: daniel } });
    // Agency B is only ever warned about its own client with these details, never about agency A's.
    signInAs(agencyB, agentB);
    expect(await createClientAction(null, form({ ...fields, phone: "+972 50 123 4567" }))).toMatchObject({ duplicate: { name: "Secret Person" } });
  });

  it("the client card lists the client's own bookings and opens on a phone where the agent is looking", async () => {
    const make = (agencyId: string, reference: string, leadEmail: string) =>
      db.booking.create({
        data: {
          reference, agencyId, userId: agencyId === agencyA ? agentA : agentB, status: "CONFIRMED", propertyId: "1", hotelName: `Hotel ${reference}`, hotelCity: "Paris", roomId: "r", roomName: "Room", rateId: "x",
          bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [], leadGivenName: "Daniel", leadFamilyName: "Levy", leadEmail,
          leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 10_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "t",
        },
      });
    await make(agencyA, "APL-OWN00001", "daniel@example.com");
    await make(agencyA, "APL-OTHER001", "someone@example.com");
    await make(agencyB, "APL-AGENCYB1", "daniel@example.com");
    const html = await render({ id: daniel });
    expect(html).toContain("APL-OWN00001");
    expect(html).not.toContain("APL-OTHER001");
    expect(html).not.toContain("APL-AGENCYB1");
    expect(html).toContain(">Search hotels for this client<");
    expect(html).toMatch(/id="client"[^>]*max-lg:order-first/);
    expect(html).toContain(`href="/clients?id=${daniel}#client"`);
    // The first client open by default (nothing chosen) stays below the list on a phone.
    expect(await render()).not.toContain("max-lg:order-first");
  });

  it("edits the client and manages companions", async () => {
    const { updateClientAction, addCompanionAction, removeCompanionAction } = await import("./(agent)/clients/actions");
    await expect(updateClientAction(null, form({ clientId: daniel, ...DANIEL, notes: "Likes a sea view." }))).rejects.toThrow(
      `NEXT_REDIRECT:/clients?id=${daniel}`,
    );
    expect(await getClient(agencyA, daniel)).toMatchObject({ notes: "Likes a sea view." });

    const added = await addCompanionAction(null, form({ clientId: daniel, firstName: "Maya", lastName: "Levy", relation: "Spouse", childAge: "" }));
    expect(added).toEqual({ status: "success", message: "Companion added." });
    const noa = (await getClient(agencyA, daniel))?.companions[0]?.id ?? "";
    await removeCompanionAction(form({ companionId: noa }));
    expect((await getClient(agencyA, daniel))?.companions.map((c) => c.firstName)).toEqual(["Maya"]);
  });
});

it("the header links to Clients", () => {
  const html = renderToStaticMarkup(<Header agencyName="Sunrise Travel" balanceCents={0} />);
  expect(html).toMatch(/<a[^>]*href="\/clients"[^>]*>Clients<\/a>/);
});
