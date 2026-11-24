import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestDb } from "@/test/db";
import { GET as authorize } from "@/app/oauth/authorize/route";
import { POST as register } from "@/app/oauth/register/route";
import { POST as token } from "@/app/oauth/token/route";

// The OAuth routes themselves: body limits before anything is parsed, the browser cookie on the
// way to the consent page, and 404 while the connector is off.

const saved = process.env.MCP_PUBLIC_URL;
const RESOURCE = "https://mcp.apolles.test/mcp";

describe("assistant OAuth routes", () => {
  beforeEach(async () => {
    await resetTestDb();
    process.env.MCP_PUBLIC_URL = RESOURCE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = saved;
  });

  it("refuse a body over 8 KB (register and token) with 413", async () => {
    const big = "x".repeat(9_000);
    expect((await register(new Request("http://localhost/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: big }))).status).toBe(413);
    expect((await token(new Request("http://localhost/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `a=${big}` }))).status).toBe(413);
  });

  it("the token route refuses anything but a form, before reading it", async () => {
    expect((await token(new Request("http://localhost/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(400);
  });

  it("authorize sets the browser cookie (httpOnly, Secure, Lax, host-only) and opens the consent page", async () => {
    const reg = await register(new Request("http://localhost/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) }));
    const { client_id } = (await reg.json()) as { client_id: string };
    const params = new URLSearchParams({ response_type: "code", client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: "c".repeat(43), code_challenge_method: "S256", state: "s" });
    const response = await authorize(new Request(`http://localhost/oauth/authorize?${params}`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^\/oauth\/consent\/[A-Za-z0-9_-]{32}$/);
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-apl_oauth=[A-Za-z0-9_-]{32}; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  });

  it("authorize is 404 while the connector is off", async () => {
    delete process.env.MCP_PUBLIC_URL;
    expect((await authorize(new Request("http://localhost/oauth/authorize?client_id=x"))).status).toBe(404);
  });
});
