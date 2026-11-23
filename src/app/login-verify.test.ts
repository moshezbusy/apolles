import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgentPendingCode } from "@/server/auth/guards";
import { sendSignInCode } from "@/server/auth/signin-code";
import { resendCodeAction } from "./login/verify/actions";

// "Resend code" on /login/verify tells the truth for every outcome of sending.

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/server/auth/guards", () => ({ requireAgentPendingCode: vi.fn() }));
vi.mock("@/server/auth/signin-code", () => ({ DEVICE_COOKIE: "apl_device", DEVICE_TTL_MS: 1, sendSignInCode: vi.fn(), trustDevice: vi.fn(), verifySignInCode: vi.fn() }));

describe("resendCodeAction", () => {
  beforeEach(() => {
    vi.mocked(requireAgentPendingCode).mockResolvedValue({ userId: "u1", sessionId: "s1", email: "a@b.c" });
  });

  it.each([
    ["sent", { notice: "A new code is on its way. It expires in 10 minutes." }],
    ["limited", { error: "Too many codes for this sign-in. Sign in again to get a new one." }],
    ["limited-hour", { error: "Too many sign-in codes were sent to this account. Try again in an hour." }],
    ["failed", { error: "We could not send the code. Try again in a few minutes." }],
  ] as const)("%s → the matching message", async (result, expected) => {
    vi.mocked(sendSignInCode).mockResolvedValue(result);
    expect(await resendCodeAction()).toEqual(expected);
    expect(sendSignInCode).toHaveBeenCalledWith("s1");
  });

  it("gone (the sign-in ended meanwhile) → back to the sign-in page", async () => {
    vi.mocked(sendSignInCode).mockResolvedValue("gone");
    await expect(resendCodeAction()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
