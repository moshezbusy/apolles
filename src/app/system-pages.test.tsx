import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentError from "./(agent)/error";
import NotFound from "./not-found";

describe("system states (screen 24)", () => {
  it("404 offers search and bookings", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("We couldn&#x27;t find this page");
    expect(html).toContain('href="/search"');
    expect(html).toContain('href="/bookings"');
  });

  it("an error never shows its message, warns against booking twice, and shows the code", () => {
    const html = renderToStaticMarkup(<AgentError error={Object.assign(new Error("db password=hunter2"), { digest: "7F3K21ABCDEF99" })} reset={() => undefined} />);
    expect(html).not.toContain("hunter2");
    expect(html).toContain("so you don&#x27;t book twice");
    expect(html).toContain("Error code: 7F3K21ABCDEF");
  });
});
