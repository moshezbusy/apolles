import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendConsoleEmail } from "@/server/email/console";

const msg = {
  to: "agent@example.com",
  subject: "Reset your Apolles password",
  text: "Use this link: http://localhost:3000/set-password/SECRET-TOKEN",
};

describe("console email adapter", () => {
  let dir: string;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "apolles-email-"));
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("EMAIL_SINK_FILE", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("prints only the recipient and subject, never the body", async () => {
    await sendConsoleEmail(msg);
    expect(info).toHaveBeenCalledTimes(1);
    const printed = JSON.stringify(info.mock.calls);
    expect(printed).toContain("agent@example.com");
    expect(printed).toContain("Reset your Apolles password");
    expect(printed).not.toContain("SECRET-TOKEN");
    expect(printed).not.toContain("set-password");
  });

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendConsoleEmail(msg)).rejects.toThrow(/production/);
    expect(info).not.toHaveBeenCalled();
  });

  it("refuses to run in production even when APP_ENV=staging", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "staging");
    await expect(sendConsoleEmail(msg)).rejects.toThrow(/production/);
    expect(info).not.toHaveBeenCalled();
  });

  it("refuses to run in production even with a sink file set", async () => {
    const file = join(dir, "sink.jsonl");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_SINK_FILE", file);
    await expect(sendConsoleEmail(msg)).rejects.toThrow(/production/);
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });

  it("appends one JSON line per email to EMAIL_SINK_FILE", async () => {
    const file = join(dir, "sink.jsonl");
    vi.stubEnv("EMAIL_SINK_FILE", file);

    await sendConsoleEmail(msg);
    await sendConsoleEmail({ ...msg, to: "two@example.com", html: "<p>hi</p>" });

    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first).toEqual({
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      sentAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(first.sentAt as string))).toBe(false);
    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(second).toMatchObject({ to: "two@example.com", html: "<p>hi</p>" });
  });
});
