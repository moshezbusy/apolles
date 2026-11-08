import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { generate } from "otplib";
import { latestSetPasswordLink } from "./support/mail";
import { ADMIN_FILE, type E2eAdmin } from "./support/paths";

// The whole plan-1 flow, in one browser session per role:
//   1. admin signs in with TOTP          4. admin confirms a USD 1,000.00 top-up
//   2. admin creates agency + agent      5. agent reloads: USD 1,000.00 and one top-up row
//   3. agent sets password, signs in,    6. agent opening /admin ends at /login or a 404
//      sees USD 0.00
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
    await expect(agentPage).toHaveURL(/\/balance$/);
    await expect(agentPage.getByRole("region", { name: "Available balance" })).toContainText("USD 0.00");
    await expect(agentPage.getByRole("banner")).toContainText("USD 0.00");
  });

  await test.step("4. the admin confirms a USD 1,000.00 top-up", async () => {
    await adminPage.getByRole("row", { name: /Test Travel/ }).getByRole("link", { name: "Wallet" }).click();
    const topup = adminPage.locator("section").filter({
      has: adminPage.getByRole("heading", { name: "Bank top-up" }),
    });
    await topup.getByLabel("Amount (USD)").fill("1,000.00");
    await topup.getByLabel("Bank transfer reference").fill("BT-E2E-0001");
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

  await test.step("6. the agent opening /admin ends at /login or a 404", async () => {
    const response = await agentPage.goto("/admin");
    const atLogin = new URL(agentPage.url()).pathname === "/login";
    expect(atLogin || response?.status() === 404).toBe(true);
  });

  await adminContext.close();
  await agentContext.close();
});
