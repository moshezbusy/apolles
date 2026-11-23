import { describe, expect, it } from "vitest";
import { PdfTimeout, withPdfTimeout } from "./pdf-safety";

describe("withPdfTimeout", () => {
  it("passes a finished PDF through", async () => {
    await expect(withPdfTimeout(Promise.resolve(Buffer.from("%PDF-")), 50)).resolves.toEqual(Buffer.from("%PDF-"));
  });

  it("rejects with PdfTimeout when the PDF never finishes, instead of hanging", async () => {
    const never = new Promise<Buffer>(() => {});
    const started = Date.now();
    await expect(withPdfTimeout(never, 30)).rejects.toBeInstanceOf(PdfTimeout);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("passes the PDF library's own error through", async () => {
    await expect(withPdfTimeout(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
  });
});
