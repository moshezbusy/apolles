import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// `after()` runs its callback once the response is sent. Here the callbacks are kept, so a
// test can check that nothing was sent before the answer and then run them.
const afterTasks: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({
  after: vi.fn((task: () => Promise<unknown>) => {
    afterTasks.push(task);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })) }));
vi.mock("@/server/auth/guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/server/auth/password-tokens", () => ({ sendSetPasswordEmail: vi.fn(async () => {}) }));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const FIELDS = { agencyName: "Sunrise Travel", contactName: "Dana Cohen", email: "dana@sunrise.example", phone: "+972 50 555 0100", country: "IL", website: "sunrise.example", license: "", notes: "", terms: "on", company: "" };

let admin: string;
beforeEach(async () => {
  await resetTestDb();
  admin = (await createUser({ email: "admin@apolles.test", name: "Admin", role: "ADMIN" })).id;
  vi.mocked(requireAdmin).mockResolvedValue({ userId: admin });
  afterTasks.length = 0;
  vi.mocked(sendEmail).mockClear();
});

describe("join (02, 03)", () => {
  it("the form has every field, the terms box and no prices", async () => {
    const { default: Join } = await import("./join/page");
    const html = renderToStaticMarkup(<Join />);
    for (const name of ["agencyName", "contactName", "email", "phone", "country", "website", "license", "notes", "terms"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain("Apply for Access");
    expect(html).not.toMatch(/USD|expedia/i);
  });

  it("apply → application received; the same answer the second time (no one learns who applied)", async () => {
    const { joinAction } = await import("./join/actions");
    await expect(joinAction(null, form(FIELDS))).rejects.toThrow("NEXT_REDIRECT:/join/received");
    await expect(joinAction(null, form(FIELDS))).rejects.toThrow("NEXT_REDIRECT:/join/received");
    expect(await db.agencyApplication.count()).toBe(1);
    const bad = await joinAction(null, form({ ...FIELDS, email: "nope", company: "x" }));
    expect(bad?.values).toMatchObject({ agencyName: "Sunrise Travel" });
    expect(bad?.values).not.toHaveProperty("company");
    const { default: Received } = await import("./join/received/page");
    const html = renderToStaticMarkup(<Received />);
    expect(html).toContain("Application received");
    expect(html).not.toContain("dana@");
  });
});

describe("join emails", () => {
  it("are sent after the response, never before the answer (same timing for a new and a known address)", async () => {
    await createUser({ email: "taken@agency.example", name: "X", role: "ADMIN" });
    const { joinAction } = await import("./join/actions");
    await expect(joinAction(null, form(FIELDS))).rejects.toThrow("NEXT_REDIRECT:/join/received");
    await expect(joinAction(null, form({ ...FIELDS, email: "taken@agency.example" }))).rejects.toThrow("NEXT_REDIRECT:/join/received");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(2);
    for (const task of afterTasks) await task();
    expect(vi.mocked(sendEmail).mock.calls.map(([m]) => m.subject).sort()).toEqual([
      "New Apolles agency application",
      "You already have an Apolles account",
      "Your Apolles application was received",
    ]);
  });
});

describe("admin applications", () => {
  it("an application left Approved with no agency says so truthfully and offers to finish opening the agency", async () => {
    const app = await db.agencyApplication.create({
      data: { agencyName: "Stuck Travel", contactName: "Dana Cohen", email: "stuck@agency.example", phone: "+972 50 555 0100", country: "IL", website: "x.example", license: "", notes: "", status: "APPROVED", reviewedAt: new Date(), reviewedById: admin },
    });
    const { default: Detail } = await import("./admin/applications/[id]/page");
    const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: app.id }) }));
    expect(html).toContain("This application was approved, but opening the agency did not finish.");
    expect(html).toContain("Finish opening the agency");
    expect(html).not.toContain("The agency is in the agencies list");
    expect(html).not.toContain(">Reject<");
    const { approveAction } = await import("./admin/applications/actions");
    await expect(approveAction(null, form({ id: app.id }))).rejects.toThrow(/NEXT_REDIRECT:\/admin\/agencies\/.+\/wallet/);
    expect(await db.agency.count({ where: { name: "Stuck Travel" } })).toBe(1);
  });

  it("lists pending applications and approves one into an agency", async () => {
    const { joinAction } = await import("./join/actions");
    await joinAction(null, form(FIELDS)).catch(() => {});
    const app = await db.agencyApplication.findFirstOrThrow();
    const { default: List } = await import("./admin/applications/page");
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="/admin/applications/${app.id}"`);
    const { default: Detail } = await import("./admin/applications/[id]/page");
    expect(renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: app.id }) }))).toContain("Approve and open the agency");
    const { approveAction } = await import("./admin/applications/actions");
    await expect(approveAction(null, form({ id: app.id }))).rejects.toThrow(/NEXT_REDIRECT:\/admin\/agencies\/.+\/wallet/);
    expect(await db.agency.count()).toBe(1);
    expect(vi.mocked(requireAdmin)).toHaveBeenCalled();
  });

  it("every admin page and action checks the admin session", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    const { default: List } = await import("./admin/applications/page");
    await expect(List({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login");
    const { approveAction, rejectAction } = await import("./admin/applications/actions");
    await expect(approveAction(null, form({ id: "x" }))).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(rejectAction(null, form({ id: "x" }))).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
