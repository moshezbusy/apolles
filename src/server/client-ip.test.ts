import { describe, expect, it } from "vitest";
import { getClientIp } from "@/server/client-ip";

function h(fields: Record<string, string>): Headers {
  return new Headers(fields);
}

describe("getClientIp", () => {
  it("default (1 trusted proxy): the right-most X-Forwarded-For entry, the one the proxy appended", () => {
    expect(getClientIp(h({ "x-forwarded-for": "203.0.113.7" }), undefined)).toBe("203.0.113.7");
    expect(getClientIp(h({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }), undefined)).toBe("203.0.113.7");
  });

  it("spoofed left entries are ignored: the client cannot choose its own bucket", () => {
    const spoofed = h({ "x-forwarded-for": "1.1.1.1, 8.8.8.8 ,  198.51.100.20" });
    expect(getClientIp(spoofed, "1")).toBe("198.51.100.20");
  });

  it("N hops: the N-th entry from the right (trimmed)", () => {
    const chain = h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7 , 10.0.0.2, 10.0.0.3" });
    expect(getClientIp(chain, "2")).toBe("10.0.0.2");
    expect(getClientIp(chain, "3")).toBe("203.0.113.7");
  });

  it("fewer entries than hops → X-Forwarded-For is not used; x-real-ip is never a fallback → unknown", () => {
    expect(getClientIp(h({ "x-forwarded-for": "203.0.113.7" }), "2")).toBe("unknown");
    expect(
      getClientIp(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }), "2"),
    ).toBe("unknown");
  });

  it("0 hops: X-Forwarded-For is ignored completely", () => {
    expect(getClientIp(h({ "x-forwarded-for": "203.0.113.7" }), "0")).toBe("unknown");
    expect(
      getClientIp(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }), "0"),
    ).toBe("unknown");
  });

  it("invalid TRUSTED_PROXY_HOPS → 1", () => {
    const chain = h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" });
    for (const bad of ["", "-1", "1.5", "abc", "2x", " "]) {
      expect(getClientIp(chain, bad)).toBe("203.0.113.7");
    }
  });

  it("missing header → unknown (x-real-ip is client-settable and never used)", () => {
    expect(getClientIp(h({ "x-real-ip": "198.51.100.1" }), undefined)).toBe("unknown");
    expect(getClientIp(h({}), undefined)).toBe("unknown");
  });

  it("garbage → unknown", () => {
    for (const bad of [
      "",
      " ",
      "not-an-ip",
      "999.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "<script>",
      "1.2.3.4; DROP",
      "1.1.1.1,",
      "[1.2.3.4]",
      "::1:80:zz",
      "x".repeat(500),
    ]) {
      expect(getClientIp(h({ "x-forwarded-for": bad }), undefined)).toBe("unknown");
    }
    expect(getClientIp(h({ "x-real-ip": "garbage" }), undefined)).toBe("unknown");
  });

  it("IPv6 literals, with brackets and ports stripped; IPv4 with a port", () => {
    expect(getClientIp(h({ "x-forwarded-for": "2001:db8::1" }), undefined)).toBe("2001:db8::1");
    expect(getClientIp(h({ "x-forwarded-for": "[2001:db8::1]" }), undefined)).toBe("2001:db8::1");
    expect(getClientIp(h({ "x-forwarded-for": "[2001:DB8::1]:8443" }), undefined)).toBe("2001:db8::1");
    expect(getClientIp(h({ "x-forwarded-for": "203.0.113.7:51234" }), undefined)).toBe("203.0.113.7");
    expect(getClientIp(h({ "x-forwarded-for": "::ffff:127.0.0.1" }), undefined)).toBe("::ffff:127.0.0.1");
  });

  it("reads TRUSTED_PROXY_HOPS from the environment when no value is passed", () => {
    const chain = h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7, 10.0.0.2" });
    const previous = process.env.TRUSTED_PROXY_HOPS;
    try {
      process.env.TRUSTED_PROXY_HOPS = "2";
      expect(getClientIp(chain)).toBe("203.0.113.7");
      delete process.env.TRUSTED_PROXY_HOPS;
      expect(getClientIp(chain)).toBe("10.0.0.2");
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = previous;
    }
  });
});
