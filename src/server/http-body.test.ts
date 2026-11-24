import { describe, expect, it } from "vitest";
import { readLimitedText } from "./http-body";

describe("readLimitedText", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("reads a body within the limit", async () => {
    expect(await readLimitedText(post("hello"), 10)).toBe("hello");
    expect(await readLimitedText(new Request("http://localhost/x"), 10)).toBe("");
  });

  it("refuses a declared length over the limit without reading", async () => {
    expect(await readLimitedText(post("hi", { "content-length": "999999" }), 10)).toBeNull();
    expect(await readLimitedText(post("hi", { "content-length": "nonsense" }), 10)).toBeNull();
  });

  it("stops reading a streamed body as soon as it passes the limit", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 1000) controller.close();
      },
    });
    expect(await readLimitedText(post(stream), 4096)).toBeNull();
    expect(pulled).toBeLessThan(10);
  });
});
