import { describe, expect, it } from "vitest";
import { HANDLERS } from "./handlers";
import { JOB_KINDS } from "./kinds";

describe("HANDLERS", () => {
  it("has a handler for every job kind", () => {
    for (const kind of JOB_KINDS) expect(typeof HANDLERS[kind], kind).toBe("function");
  });
});
