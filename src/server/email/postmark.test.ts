import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendPostmarkEmail } from "@/server/email/postmark";

const TOKEN = "test-postmark-token-not-real";
const msg = {
  to: "agent@example.com",
  subject: "Set your Apolles password",
  text: "plain body",
};

function okResponse(): Response {
  return new Response(JSON.stringify({ ErrorCode: 0, Message: "OK" }), { status: 200 });
}

describe("postmark email adapter", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("POSTMARK_SERVER_TOKEN", TOKEN);
    vi.stubEnv("EMAIL_FROM", "Apolles <no-reply@apolles.test>");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("POSTs the message to the Postmark email API with the server token and a timeout", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await sendPostmarkEmail({ ...msg, html: "<p>html body</p>" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": TOKEN,
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      From: "Apolles <no-reply@apolles.test>",
      To: "agent@example.com",
      Subject: "Set your Apolles password",
      TextBody: "plain body",
      HtmlBody: "<p>html body</p>",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no HtmlBody when there is no html", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await sendPostmarkEmail(msg);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("HtmlBody");
  });

  it("non-2xx → throws with the status only, never the token or the body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 10, Message: "Bad token" }), { status: 422 }),
    );
    const error = await sendPostmarkEmail(msg).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("422");
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("plain body");
    expect(message).not.toContain("Bad token");
  });

  it("refuses to send without POSTMARK_SERVER_TOKEN or EMAIL_FROM", async () => {
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    await expect(sendPostmarkEmail(msg)).rejects.toThrow(/POSTMARK_SERVER_TOKEN/);
    vi.stubEnv("POSTMARK_SERVER_TOKEN", TOKEN);
    vi.stubEnv("EMAIL_FROM", "");
    await expect(sendPostmarkEmail(msg)).rejects.toThrow(/EMAIL_FROM/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
