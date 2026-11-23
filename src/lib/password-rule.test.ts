import { describe, expect, it } from "vitest";
import { COMMON_PASSWORD_COPY, PASSWORD_MIN_LENGTH, PASSWORD_RULE_COPY, isCommonPassword, isValidPassword, passwordProblem, passwordRuleCopy } from "./password-rule";

describe("password rule", () => {
  it("agents: at least 8 characters with a letter and a digit (unchanged)", () => {
    expect(PASSWORD_MIN_LENGTH.AGENT).toBe(8);
    expect(isValidPassword("abcdefg1")).toBe(true);
    expect(isValidPassword("abcdefg1", "AGENT")).toBe(true);
    expect(isValidPassword("abcdef1")).toBe(false);
    expect(isValidPassword("abcdefgh")).toBe(false);
    expect(isValidPassword("12345678")).toBe(false);
    expect(isValidPassword(`a1${"x".repeat(255)}`)).toBe(false);
  });

  it("admins: at least 12 characters", () => {
    expect(PASSWORD_MIN_LENGTH.ADMIN).toBe(12);
    expect(isValidPassword("abcdefg1", "ADMIN")).toBe(false);
    expect(isValidPassword("abcdefghij1", "ADMIN")).toBe(false);
    expect(isValidPassword("abcdefghijk1", "ADMIN")).toBe(true);
    expect(passwordProblem("abcdefg1", "ADMIN")).toBe("RULE");
  });

  it("the most common passwords are refused for everyone, in any letter case", () => {
    // Words in one text (not quoted one by one): see the note at the list in password-rule.ts.
    for (const common of "password1 Password1 PASSWORD123 qwerty123 abc12345 1q2w3e4r admin123 welcome1 passw0rd iloveyou1 apolles123".split(" ")) {
      expect(isCommonPassword(common), common).toBe(true);
      expect(isValidPassword(common), common).toBe(false);
      expect(passwordProblem(common, "AGENT"), common).toBe("COMMON");
    }
    for (const common of "password1234 Administrator1 qwertyuiop123 1qaz2wsx3edc".split(" ")) {
      expect(isValidPassword(common, "ADMIN"), common).toBe(false);
      expect(passwordProblem(common, "ADMIN"), common).toBe("COMMON");
    }
    expect(isCommonPassword("violet-Harbor-27")).toBe(false);
    expect(passwordProblem("violet-Harbor-27", "ADMIN")).toBeNull();
  });

  it("a password that is too short is reported as the rule, not as common", () => {
    expect(passwordProblem("pass1", "AGENT")).toBe("RULE");
  });

  it("the hint texts name the right length for each role", () => {
    expect(PASSWORD_RULE_COPY).toBe("At least 8 characters, with letters and numbers.");
    expect(passwordRuleCopy("AGENT")).toBe(PASSWORD_RULE_COPY);
    expect(passwordRuleCopy("ADMIN")).toBe("At least 12 characters, with letters and numbers.");
    expect(COMMON_PASSWORD_COPY).toBe("This password is too common and easy to guess. Choose a different one.");
  });
});
