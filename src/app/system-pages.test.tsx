import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentError from "./(agent)/error";
import RootError from "./error";
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

  it("an error outside the agent area shows no message and no link into the agent area", () => {
    const html = renderToStaticMarkup(<RootError error={Object.assign(new Error("secret=xyz"), { digest: "ABCDEF123456" })} reset={() => undefined} />);
    expect(html).not.toContain("xyz");
    expect(html).not.toContain('href="/bookings"');
    expect(html).toContain("Error code: ABCDEF123456");
  });

  it("404 says bookings and quotes are safe", () => {
    expect(renderToStaticMarkup(<NotFound />)).toContain("Your bookings and quotes are safe.");
  });
});
