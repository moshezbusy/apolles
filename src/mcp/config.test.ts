import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const ENV = {
  MCP_PUBLIC_URL: "https://mcp.example.test/",
  APOLLES_INTERNAL_URL: "http://app:3000",
  AI_MCP_SERVICE_KEY: "test-service-key-0123456789",
  APP_PUBLIC_URL: "https://app.example.test/",
  PORT: "9090",
};

// Records every variable name read, so the test can see nothing else is touched.
function watched(env: Record<string, string | undefined>) {
  const read = new Set<string>();
  const proxy = new Proxy(env, {
    get(target, key) {
      if (typeof key === "string") read.add(key);
      return target[key as string];
    },
  });
  return { env: proxy, read };
}

describe("MCP server config", () => {
  it("reads the five variables, without trailing slashes", () => {
    expect(loadConfig(ENV)).toEqual({
      publicUrl: "https://mcp.example.test",
      internalUrl: "http://app:3000",
      serviceKey: "test-service-key-0123456789",
      authServer: "https://app.example.test",
      port: 9090,
    });
  });

  it("reads no other variable: the database and supplier settings never reach it", () => {
    const { env, read } = watched({ ...ENV, DATABASE_URL: "postgresql://u:p@db/x", EXPEDIA_API_KEY: "ek_secret", EXPEDIA_SHARED_SECRET: "es_secret" });
    const config = loadConfig(env);
    expect([...read].sort()).toEqual(["AI_MCP_SERVICE_KEY", "APOLLES_INTERNAL_URL", "APP_PUBLIC_URL", "MCP_PUBLIC_URL", "PORT"]);
    expect(Object.keys(config).sort()).toEqual(["authServer", "internalUrl", "port", "publicUrl", "serviceKey"]);
    const text = JSON.stringify(config);
    for (const value of ["postgresql://u:p@db/x", "ek_secret", "es_secret"]) expect(text).not.toContain(value);
  });

  it("reads process.env by default", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, ENV, { DATABASE_URL: "postgresql://u:p@db/x", EXPEDIA_API_KEY: "ek_secret" });
      const text = JSON.stringify(loadConfig());
      expect(text).toContain("https://mcp.example.test");
      expect(text).not.toContain("ek_secret");
      expect(text).not.toContain("postgresql://");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it.each(["MCP_PUBLIC_URL", "APOLLES_INTERNAL_URL", "AI_MCP_SERVICE_KEY", "APP_PUBLIC_URL"])("throws at start when %s is missing or empty", (name) => {
    expect(() => loadConfig({ ...ENV, [name]: undefined })).toThrow(name);
    expect(() => loadConfig({ ...ENV, [name]: "" })).toThrow(name);
  });

  it("PORT defaults to 8080; a bad PORT throws", () => {
    expect(loadConfig({ ...ENV, PORT: undefined }).port).toBe(8080);
    for (const port of ["0", "65536", "80a", "-1", "8.5"]) expect(() => loadConfig({ ...ENV, PORT: port })).toThrow("PORT");
  });

  it("public addresses must be https; the internal one may be http", () => {
    expect(() => loadConfig({ ...ENV, MCP_PUBLIC_URL: "http://mcp.example.test" })).toThrow("MCP_PUBLIC_URL");
    expect(() => loadConfig({ ...ENV, APP_PUBLIC_URL: "http://app.example.test" })).toThrow("APP_PUBLIC_URL");
    expect(() => loadConfig({ ...ENV, APOLLES_INTERNAL_URL: "ftp://app" })).toThrow("APOLLES_INTERNAL_URL");
    expect(() => loadConfig({ ...ENV, APOLLES_INTERNAL_URL: "not a url" })).toThrow("APOLLES_INTERNAL_URL");
    expect(loadConfig({ ...ENV, APOLLES_INTERNAL_URL: "https://app.internal/" }).internalUrl).toBe("https://app.internal");
  });

  it("the error names the variable, never its value", () => {
    expect(() => loadConfig({ ...ENV, MCP_PUBLIC_URL: "http://secret-host.example" })).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secret-host") }));
  });
});
