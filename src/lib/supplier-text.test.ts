import { describe, expect, it } from "vitest";
import { toBlocks } from "./supplier-text";

describe("toBlocks (supplier HTML shown as plain text)", () => {
  it("splits paragraphs and line breaks, and keeps list items as items", () => {
    expect(toBlocks("<p>First line<br>second line</p><p>Next</p><ul><li>Pool</li><li>Gym</li></ul>")).toEqual([
      { kind: "p", text: "First line" },
      { kind: "p", text: "second line" },
      { kind: "p", text: "Next" },
      { kind: "li", text: "Pool" },
      { kind: "li", text: "Gym" },
    ]);
  });

  it("drops script and style content and every other tag; decodes entities", () => {
    expect(toBlocks('<script>alert(1)</script><style>p{}</style><b onclick="x()">Fish &amp; chips &lt;3 &#39;ok&#39; &#x2713;</b>')).toEqual([
      { kind: "p", text: "Fish & chips <3 'ok' ✓" },
    ]);
  });

  it("an unclosed tag or stray brackets never leak markup", () => {
    const out = toBlocks('Price <img src=x onerror="alert(1)" and more');
    expect(out.map((b) => b.text).join(" ")).not.toMatch(/[<>]|onerror/);
  });

  it("empty, null or whitespace gives no blocks", () => {
    expect(toBlocks(null)).toEqual([]);
    expect(toBlocks("  <p> </p> ")).toEqual([]);
  });

  it("caps very long text", () => {
    expect(toBlocks("x".repeat(50_000)).map((b) => b.text).join("").length).toBeLessThanOrEqual(20_000);
  });
});
