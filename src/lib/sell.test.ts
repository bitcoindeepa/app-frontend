import { describe, expect, it } from "vitest";
import { estimateSellLkr, satsForLkr } from "@/lib/sell";

const RATE = 30_000_000;

describe("estimateSellLkr", () => {
  it("takes the fee, then the bank charge, off the sale", () => {
    // 100,000 sats at 30M = 30,000.00; 1.5% fee = 450.00; bank charge 50.00
    expect(estimateSellLkr(100_000, 150, RATE, 50)).toEqual({
      grossLkr: 30_000,
      feeLkr: 450,
      bankChargeLkr: 50,
      amountLkr: 29_500,
    });
  });

  it("rounds the sale down and the fee up, to the cent", () => {
    // 3,333 sats at 30M = 999.90; 1.25% fee = 12.49875 -> 12.50
    expect(estimateSellLkr(3_333, 125, RATE)).toEqual({
      grossLkr: 999.9,
      feeLkr: 12.5,
      bankChargeLkr: 0,
      amountLkr: 987.4,
    });
    // 1 sat at 29,999,999 = 0.29999999 -> 0.29
    expect(estimateSellLkr(1, 0, 29_999_999).grossLkr).toBe(0.29);
  });

  it("never pays out a negative amount", () => {
    expect(estimateSellLkr(100, 150, RATE, 50).amountLkr).toBe(0);
  });

  it("is all zeros without an amount or a rate", () => {
    const zeros = { grossLkr: 0, feeLkr: 0, bankChargeLkr: 0, amountLkr: 0 };
    expect(estimateSellLkr(0, 150, RATE, 50)).toEqual(zeros);
    expect(estimateSellLkr(-5, 150, RATE, 50)).toEqual(zeros);
    expect(estimateSellLkr(Number.NaN, 150, RATE, 50)).toEqual(zeros);
    expect(estimateSellLkr(100_000, 150, 0, 50)).toEqual(zeros);
  });
});

describe("satsForLkr", () => {
  it("is zero without an amount or a rate", () => {
    expect(satsForLkr(0, 150, RATE)).toBe(0);
    expect(satsForLkr(1000, 150, 0)).toBe(0);
  });

  it("works back from the amount to receive", () => {
    // (29,500 + 50) / (1 - 0.015) = 30,000 LKR = 100,000 sats
    expect(satsForLkr(29_500, 150, RATE, 50)).toBe(100_000);
  });

  it.each([500, 1_000, 2_750.5, 29_500, 123_456.78])(
    "asks for enough sats to receive %s rupees",
    (amountLkr) => {
      const sats = satsForLkr(amountLkr, 150, RATE, 50);
      expect(Number.isInteger(sats)).toBe(true);
      expect(estimateSellLkr(sats, 150, RATE, 50).amountLkr).toBeGreaterThanOrEqual(amountLkr);
      // and not far more than that: one sat fewer falls short, give or take a cent
      expect(estimateSellLkr(sats - 1, 150, RATE, 50).amountLkr).toBeLessThan(amountLkr + 0.01);
    }
  );
});
