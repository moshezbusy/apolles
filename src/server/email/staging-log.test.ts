import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendStagingLogEmail } from "@/server/email/staging-log";

const msg = {
  to: "admin@example.com",
  subject: "Set your Apolles password",
  text: "Use this link: https://staging.apolles.com/set-password/STAGING-TOKEN",
};

describe("staging-log email adapter", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("with APP_ENV=staging writes the whole message as one JSON line to stdout", async () => {
    vi.stubEnv("APP_ENV", "staging");
    await sendStagingLogEmail({ ...msg, html: "<p>not logged</p>" });

    expect(log).toHaveBeenCalledTimes(1);
    const [line] = log.mock.calls[0]! as [string];
    expect(typeof line).toBe("string");
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      type: "staging-email",
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
  });

  it("works in the production build of the app (NODE_ENV=production) on staging", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("NODE_ENV", "production");
    await sendStagingLogEmail(msg);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("throws and logs nothing when APP_ENV is not set", async () => {
    vi.stubEnv("APP_ENV", undefined);
    await expect(sendStagingLogEmail(msg)).rejects.toThrow(/APP_ENV=staging/);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("throws and logs nothing when APP_ENV=production", async () => {
    vi.stubEnv("APP_ENV", "production");
    await expect(sendStagingLogEmail(msg)).rejects.toThrow(/APP_ENV=staging/);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("accepts only the exact value 'staging'", async () => {
    for (const value of ["", "Staging", "STAGING", " staging", "staging ", "stage"]) {
      vi.stubEnv("APP_ENV", value);
      await expect(sendStagingLogEmail(msg)).rejects.toThrow(/APP_ENV=staging/);
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("the error never contains the message body", async () => {
    vi.stubEnv("APP_ENV", "production");
    const error = await sendStagingLogEmail(msg).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("STAGING-TOKEN");
  });
});
