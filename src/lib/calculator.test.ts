import { describe, expect, it } from "vitest";
import { cleanAmount, convert, fmtCalc, groupTyped } from "@/lib/calculator";

const rates = { btcLkr: 30_000_000, btcUsd: 100_000 };

describe("convert", () => {
  it("converts rupees to every unit", () => {
    expect(convert(30_000, "lkr", rates)).toEqual({
      lkr: 30_000,
      usd: 100,
      btc: 0.001,
      sats: 100_000,
    });
  });

  it("converts sats to every unit", () => {
    expect(convert(100_000, "sats", rates)).toEqual({
      lkr: 30_000,
      usd: 100,
      btc: 0.001,
      sats: 100_000,
    });
  });

  it("converts dollars and BTC", () => {
    expect(convert(100, "usd", rates)?.sats).toBe(100_000);
    expect(convert(1, "btc", rates)).toEqual({
      lkr: 30_000_000,
      usd: 100_000,
      btc: 1,
      sats: 100_000_000,
    });
  });

  it("rounds sats down, like a buy", () => {
    // 100 LKR at 30M is 333.33 sats
    const result = convert(100, "lkr", rates);
    expect(result?.sats).toBe(333);
    expect(result?.btc).toBe(0.00000333);
  });

  it("keeps the typed value exact", () => {
    expect(convert(100, "lkr", rates)?.lkr).toBe(100);
    expect(convert(0.123456789, "btc", rates)?.btc).toBe(0.123456789);
  });

  it("doesn't lose a sat to float noise", () => {
    // 0.07 BTC * 1e8 is 7000000.000000001 in floating point; 0.29 * 1e8 is 28999999.999999996
    expect(convert(0.07, "btc", rates)?.sats).toBe(7_000_000);
    expect(convert(0.29, "btc", rates)?.sats).toBe(29_000_000);
  });

  it("leaves dollars out while the dollar rate is unknown", () => {
    expect(convert(30_000, "lkr", { btcLkr: 30_000_000 })).toEqual({
      lkr: 30_000,
      usd: null,
      btc: 0.001,
      sats: 100_000,
    });
  });

  it("can't convert from dollars without the dollar rate", () => {
    expect(convert(100, "usd", { btcLkr: 30_000_000 })).toBeNull();
  });
});

describe("cleanAmount", () => {
  it("drops commas, letters and leading zeros", () => {
    expect(cleanAmount("12,345", "lkr")).toBe("12345");
    expect(cleanAmount("00120", "sats")).toBe("120");
    expect(cleanAmount("12abc", "lkr")).toBe("12");
    expect(cleanAmount("0", "lkr")).toBe("0");
  });

  it("keeps one dot and the unit's decimals", () => {
    expect(cleanAmount("12.345", "lkr")).toBe("12.34");
    expect(cleanAmount("1.2.3", "usd")).toBe("1.23");
    expect(cleanAmount("0.123456789", "btc")).toBe("0.12345678");
  });

  it("keeps a dot the user has just typed", () => {
    expect(cleanAmount("12.", "lkr")).toBe("12.");
    expect(cleanAmount(".5", "lkr")).toBe("0.5");
  });

  it("has no decimals for sats", () => {
    expect(cleanAmount("12.5", "sats")).toBe("12");
  });

  it("limits the whole digits", () => {
    expect(cleanAmount("9".repeat(20), "lkr")).toHaveLength(15);
    expect(cleanAmount("9".repeat(20), "sats")).toHaveLength(16);
  });
});

describe("display", () => {
  it("groups a value for its box", () => {
    expect(fmtCalc(12345.5, "lkr")).toBe("12,345.5");
    expect(fmtCalc(0.00012345, "btc")).toBe("0.00012345");
    expect(fmtCalc(1234567, "sats")).toBe("1,234,567");
  });

  it("groups what was typed and keeps it as typed", () => {
    expect(groupTyped("")).toBe("");
    expect(groupTyped("12345")).toBe("12,345");
    expect(groupTyped("12345.")).toBe("12,345.");
    expect(groupTyped("12345.50")).toBe("12,345.50");
    expect(groupTyped(".5")).toBe("0.5");
  });
});
