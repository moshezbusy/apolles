import { afterEach, describe, expect, it, vi } from "vitest";
import { sendConsoleEmail } from "@/server/email/console";
import { sendPostmarkEmail } from "@/server/email/postmark";
import { sendStagingLogEmail } from "@/server/email/staging-log";
import { sendEmail } from "@/server/email/port";

vi.mock("@/server/email/console", () => ({ sendConsoleEmail: vi.fn() }));
vi.mock("@/server/email/postmark", () => ({ sendPostmarkEmail: vi.fn() }));
vi.mock("@/server/email/staging-log", () => ({ sendStagingLogEmail: vi.fn() }));

const msg = { to: "a@example.com", subject: "Hi", text: "body" };

describe("sendEmail provider selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(sendConsoleEmail).mockClear();
    vi.mocked(sendPostmarkEmail).mockClear();
    vi.mocked(sendStagingLogEmail).mockClear();
  });

  it("defaults to the console adapter when EMAIL_PROVIDER is unset", async () => {
    vi.stubEnv("EMAIL_PROVIDER", undefined);
    await sendEmail(msg);
    expect(sendConsoleEmail).toHaveBeenCalledWith(msg);
    expect(sendPostmarkEmail).not.toHaveBeenCalled();
  });

  it("EMAIL_PROVIDER=console → console adapter", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    await sendEmail(msg);
    expect(sendConsoleEmail).toHaveBeenCalledWith(msg);
  });

  it("EMAIL_PROVIDER=postmark → postmark adapter", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "postmark");
    await sendEmail(msg);
    expect(sendPostmarkEmail).toHaveBeenCalledWith(msg);
    expect(sendConsoleEmail).not.toHaveBeenCalled();
  });

  it("EMAIL_PROVIDER=staging-log → staging-log adapter (which checks APP_ENV itself)", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "staging-log");
    await sendEmail(msg);
    expect(sendStagingLogEmail).toHaveBeenCalledWith(msg);
    expect(sendConsoleEmail).not.toHaveBeenCalled();
    expect(sendPostmarkEmail).not.toHaveBeenCalled();
  });

  it("APP_ENV=staging alone never selects the staging-log adapter", async () => {
    vi.stubEnv("APP_ENV", "staging");
    for (const provider of [undefined, "console", "postmark"]) {
      vi.stubEnv("EMAIL_PROVIDER", provider);
      await sendEmail(msg);
    }
    expect(sendStagingLogEmail).not.toHaveBeenCalled();
  });

  it("any other EMAIL_PROVIDER → clear error at send time", async () => {
    for (const provider of ["smtp", "staging", "Staging-Log", "staging-log "]) {
      vi.stubEnv("EMAIL_PROVIDER", provider);
      await expect(sendEmail(msg)).rejects.toThrow(/EMAIL_PROVIDER/);
    }
    expect(sendConsoleEmail).not.toHaveBeenCalled();
    expect(sendPostmarkEmail).not.toHaveBeenCalled();
    expect(sendStagingLogEmail).not.toHaveBeenCalled();
  });

  it("the error lists every valid provider", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    await expect(sendEmail(msg)).rejects.toThrow(/"console", "postmark" or "staging-log"/);
  });
});
