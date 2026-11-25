import { describe, expect, it } from "vitest";
import { estimateBuy } from "@/lib/buy";

describe("estimateBuy", () => {
  it("takes both fees off the amount, then buys whole sats", () => {
    // 10,000 LKR, 3% + 1% = 400 in fees, 9,600 at 30M = 32,000 sats
    expect(estimateBuy(10_000, 300, 100, 30_000_000)).toEqual({
      feeLkr: 400,
      netLkr: 9_600,
      sats: 32_000,
    });
  });

  it("rounds sats down", () => {
    // 100 LKR, no fees, at 30M = 333.33 sats
    expect(estimateBuy(100, 0, 0, 30_000_000).sats).toBe(333);
  });

  it("is all zeros without an amount or a price", () => {
    const zeros = { feeLkr: 0, netLkr: 0, sats: 0 };
    expect(estimateBuy(0, 300, 100, 30_000_000)).toEqual(zeros);
    expect(estimateBuy(-100, 300, 100, 30_000_000)).toEqual(zeros);
    expect(estimateBuy(Number.NaN, 300, 100, 30_000_000)).toEqual(zeros);
    expect(estimateBuy(10_000, 300, 100, 0)).toEqual(zeros);
  });
});
