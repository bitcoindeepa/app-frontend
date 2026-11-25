import { describe, expect, it } from "vitest";
import { USERNAME_RE, normalizeUsername } from "@/lib/username";

describe("normalizeUsername", () => {
  it("drops the @, the spaces and the capitals", () => {
    expect(normalizeUsername("@Kasun_77 ")).toBe("kasun_77");
    expect(normalizeUsername("  @@kasun")).toBe("kasun");
    expect(normalizeUsername("kasun")).toBe("kasun");
  });
});

describe("USERNAME_RE", () => {
  it.each(["abc", "kasun_77", "a_1", `a${"b".repeat(19)}`])("accepts %s", (name) => {
    expect(USERNAME_RE.test(name)).toBe(true);
  });

  it.each([
    ["ab", "too short"],
    [`a${"b".repeat(20)}`, "too long"],
    ["1abc", "starts with a digit"],
    ["_abc", "starts with an underscore"],
    ["Kasun", "has a capital"],
    ["ka-sun", "has a dash"],
    ["ka sun", "has a space"],
    ["@kasun", "has the @"],
  ])("refuses %s (%s)", (name) => {
    expect(USERNAME_RE.test(name)).toBe(false);
  });
});
