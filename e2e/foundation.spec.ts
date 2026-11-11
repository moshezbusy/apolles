import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { generate } from "otplib";
import { latestSetPasswordLink } from "./support/mail";
import { ADMIN_FILE, type E2eAdmin } from "./support/paths";
import { solidPng } from "./support/png";

// The whole plan-1 flow, in one browser session per role:
//   1. admin signs in with TOTP          4. admin confirms a USD 1,000.00 top-up
//   2. admin creates agency + agent      5. agent reloads: USD 1,000.00 and one top-up row
//   3. agent sets password, signs in,    6. agent opening /admin ends at /login or a 404
//      sees USD 0.00                     7. admin signs out: /admin then goes to /login
//                                        8. agent signs out: /balance then goes to /login
// The admin signs in once only: a TOTP code is accepted once per 30-second step.

const AGENT_EMAIL = "agent@test.local";
const AGENT_PASSWORD = "Passw0rd1";

function readAdmin(): E2eAdmin {
  return JSON.parse(readFileSync(ADMIN_FILE, "utf8")) as E2eAdmin;
}

// Yesterday in UTC: never "in the future" for the top-up form, whatever the time zone.
function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("foundation: admin creates an agency, tops it up, the agent sees the balance", async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = readAdmin();
  const adminContext = await browser.newContext();
  const agentContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const agentPage = await agentContext.newPage();

  await test.step("1. the admin signs in with TOTP", async () => {
    await signIn(adminPage, admin.email, admin.password);
    await expect(adminPage).toHaveURL(/\/admin\/2fa$/);
    await adminPage.getByLabel("6-digit code").fill(await generate({ secret: admin.totpSecret }));
    await adminPage.getByRole("button", { name: "Continue" }).click();
    await expect(adminPage).toHaveURL(/\/admin\/agencies$/);
    await expect(adminPage.getByRole("heading", { name: "Agencies" })).toBeVisible();
  });

  await test.step("2. the admin creates agency Test Travel with agent@test.local", async () => {
    await adminPage.getByRole("link", { name: "New agency" }).click();
    await adminPage.getByLabel("Agency name").fill("Test Travel");
    await adminPage.getByLabel("Country (2-letter code, e.g. IL)").fill("IL");
    await adminPage.getByLabel("Agent name").fill("Test Agent");
    await adminPage.getByLabel("Agent email").fill(AGENT_EMAIL);
    await adminPage.getByRole("button", { name: "Create agency" }).click();
    await expect(adminPage).toHaveURL(/\/admin\/agencies$/);
    await expect(adminPage.getByRole("row", { name: /Test Travel/ })).toBeVisible();
  });

  await test.step("3. the agent sets Passw0rd1, signs in and sees USD 0.00", async () => {
    await expect.poll(() => latestSetPasswordLink(AGENT_EMAIL), { timeout: 15_000 }).not.toBeNull();
    const link = latestSetPasswordLink(AGENT_EMAIL) ?? "";
    await agentPage.goto(link);
    await expect(agentPage.getByRole("heading", { name: "Set your password" })).toBeVisible();
    await agentPage.getByLabel("New password").fill(AGENT_PASSWORD);
    await agentPage.getByLabel("Confirm password").fill(AGENT_PASSWORD);
    await agentPage.getByRole("button", { name: "Save password" }).click();
    await expect(agentPage).toHaveURL(/\/login\?reset=1$/);

    await signIn(agentPage, AGENT_EMAIL, AGENT_PASSWORD);
    await expect(agentPage).toHaveURL(/\/search$/);
    await agentPage.goto("/balance");
    await expect(agentPage.getByRole("region", { name: "Available balance" })).toContainText("USD 0.00");
    await expect(agentPage.getByRole("banner")).toContainText("USD 0.00");
  });

  await test.step("4. the admin confirms a USD 1,000.00 top-up", async () => {
    await adminPage.getByRole("row", { name: /Test Travel/ }).getByRole("link", { name: "Wallet" }).click();
    const topup = adminPage.locator("section").filter({
      has: adminPage.getByRole("heading", { name: "Bank top-up" }),
    });
    await topup.getByLabel("Amount (USD)").fill("1,000.00");
    await topup.getByLabel("Bank's transfer reference (from the bank statement)").fill("BT-E2E-0001");
    await topup.getByLabel("Received on").fill(yesterday());
    await topup.getByRole("button", { name: "Review" }).click();
    await expect(topup).toContainText("Confirm top-up of USD 1,000.00 to Test Travel?");
    await topup.getByRole("button", { name: "Confirm top-up" }).click();
    await expect(topup.getByRole("status")).toHaveText("Top-up of USD 1,000.00 recorded.");
  });

  await test.step("5. the agent reloads and sees USD 1,000.00 and one top-up row", async () => {
    await agentPage.reload();
    await expect(agentPage.getByRole("region", { name: "Available balance" })).toContainText("USD 1,000.00");
    await expect(agentPage.getByRole("banner")).toContainText("USD 1,000.00");
    const history = agentPage.getByRole("region", { name: "History" });
    await expect(history.locator("tbody tr")).toHaveCount(1);
    await expect(history.locator("tbody tr").filter({ hasText: "Top-up · bank transfer" })).toHaveCount(1);
    await expect(history.locator("tbody tr")).toContainText("+USD 1,000.00");
  });

  await test.step("5b. the agent fills in the agency details and uploads a logo", async () => {
    await agentPage.getByRole("banner").getByText("Test Travel", { exact: true }).click(); // agency menu
    await agentPage.getByRole("banner").getByRole("link", { name: "Agency settings" }).click();
    await expect(agentPage).toHaveURL(/\/settings$/);
    await agentPage.getByLabel("Business email").fill("office@test-travel.example");
    await agentPage.getByLabel("Phone").fill("+972 50 123 4567");
    await agentPage.getByRole("button", { name: "Save changes" }).click();
    const details = agentPage.getByRole("region", { name: "Agency details" });
    await expect(details.getByRole("status")).toHaveText("Changes saved.");

    await agentPage.getByLabel("Upload a logo").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: solidPng(320, 100),
    });
    await agentPage.getByRole("button", { name: "Upload logo" }).click();
    const logoSection = agentPage.getByRole("region", { name: "Agency logo" });
    await expect(logoSection.getByRole("status")).toHaveText("Logo saved.");
    const logo = agentPage.getByRole("img", { name: "Test Travel logo" });
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);

    await agentPage.reload();
    await expect(agentPage.getByLabel("Phone")).toHaveValue("+972 50 123 4567");
  });

  await test.step("5c. the agent searches Paris, filters, opens a hotel and sees its rates and policies", async () => {
    await agentPage.getByRole("banner").getByRole("link", { name: "Search", exact: true }).click();
    await expect(agentPage.getByRole("heading", { name: "Hotel search" })).toBeVisible();
    await agentPage.getByRole("combobox", { name: "Destination" }).fill("Par");
    await agentPage.getByRole("option", { name: /Paris, Ile-de-France, France/ }).click();
    await agentPage.getByRole("button", { name: "Search" }).click();
    await expect(agentPage.getByText("3 properties found")).toBeVisible();

    await agentPage.getByLabel("Hotel name").fill("Lumiere");
    await agentPage.getByRole("button", { name: "Apply filters" }).click();
    await expect(agentPage.getByText("1 property found")).toBeVisible();

    await agentPage.getByRole("link", { name: "View rooms" }).click();
    await expect(agentPage.getByRole("heading", { name: /Hotel Lumiere/ })).toBeVisible();
    const rooms = agentPage.getByRole("region", { name: /Room options/ });
    await expect(rooms).toContainText("Non-refundable");
    await expect(rooms).toContainText("Free cancellation until");
    await expect(rooms).toContainText("Bed type is a request and not guaranteed.");
    await expect(rooms).toContainText("Taxes and fees");
    await expect(rooms).toContainText("Paid at the property, not included in the total");
    await expect(agentPage.getByRole("region", { name: "Policies" })).toContainText("Know before you go");

    await agentPage.getByRole("link", { name: "← Back to hotels" }).click();
    await expect(agentPage.getByText("1 property found")).toBeVisible();
  });

  await test.step("6. the agent opening /admin ends at /login or a 404", async () => {
    const response = await agentPage.goto("/admin");
    const atLogin = new URL(agentPage.url()).pathname === "/login";
    expect(atLogin || response?.status() === 404).toBe(true);
  });

  await test.step("7. the admin signs out with the header button; /admin then goes to /login", async () => {
    await adminPage.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await expect(adminPage).toHaveURL(/\/login$/);
    await adminPage.goto("/admin");
    await expect(adminPage).toHaveURL(/\/login$/);
  });

  await test.step("8. the agent signs out from the agency menu; /balance then goes to /login", async () => {
    // Step 6 did not end the agent's session: the agent is still signed in here.
    await agentPage.goto("/balance");
    await expect(agentPage).toHaveURL(/\/balance$/);
    const banner = agentPage.getByRole("banner");
    await banner.getByText("Test Travel", { exact: true }).click(); // opens the agency menu
    await banner.getByRole("button", { name: "Sign out" }).click();
    await expect(agentPage).toHaveURL(/\/login$/);
    const response = await agentPage.goto("/balance");
    await expect(agentPage).toHaveURL(/\/login$/);
    // Every page refuses to be framed by another site.
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  });

  await adminContext.close();
  await agentContext.close();
});
