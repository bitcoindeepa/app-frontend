import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fmtActivityDateTime,
  fmtActivityGroupLabel,
  fmtActivityTime,
  fmtBtc,
  fmtLkr,
  fmtLkrCurrency,
  fmtLkrCurrencyCompact,
  fmtLkrExact,
  fmtLkrPreset,
  fmtPriceCompact,
  fmtRelativeDays,
  fmtSats,
  fmtSatsCompact,
  fmtShortDate,
  fmtUsd,
  formatSatoshis,
  maskDigits,
} from "@/lib/formatters";

describe("rupees", () => {
  it("always shows two decimals", () => {
    expect(fmtLkr(45700)).toBe("45,700.00");
    expect(fmtLkr(19800.5)).toBe("19,800.50");
    expect(fmtLkr(0)).toBe("0.00");
    expect(fmtLkr(0.1 + 0.2)).toBe("0.30");
  });

  it("rounds to the cent instead of cutting", () => {
    expect(fmtLkr(1234.567)).toBe("1,234.57");
    expect(fmtLkr(99.999)).toBe("100.00");
  });

  it("shows 0.00 for a value that isn't a number", () => {
    expect(fmtLkr(Number.NaN)).toBe("0.00");
    expect(fmtLkr(Number.POSITIVE_INFINITY)).toBe("0.00");
  });

  it("adds the රු. symbol", () => {
    expect(fmtLkrCurrency(45700)).toBe("රු. 45,700.00");
    expect(fmtLkrExact(19800.5)).toBe("රු. 19,800.50");
  });

  it("keeps preset chips whole", () => {
    expect(fmtLkrPreset(25000)).toBe("රු. 25,000");
    expect(fmtLkrPreset(500)).toBe("රු. 500");
  });

  it("abbreviates compact labels", () => {
    expect(fmtPriceCompact(29_500_000)).toBe("29.5M");
    expect(fmtPriceCompact(1_000_000)).toBe("1.0M");
    expect(fmtPriceCompact(45_700)).toBe("45.7K");
    expect(fmtPriceCompact(999)).toBe("999.00");
    expect(fmtLkrCurrencyCompact(29_500_000)).toBe("රු. 29.5M");
  });
});

describe("sats and BTC", () => {
  it("groups whole sats and drops any fraction", () => {
    expect(fmtSats(100000)).toBe("100,000");
    expect(fmtSats(1234.9)).toBe("1,234");
    expect(fmtSats(0)).toBe("0");
  });

  it("abbreviates compact sats", () => {
    expect(fmtSatsCompact(999)).toBe("999");
    expect(fmtSatsCompact(214_000)).toBe("214K");
    expect(fmtSatsCompact(1_500_000)).toBe("1.5M");
  });

  it("converts sats to BTC", () => {
    expect(formatSatoshis(100_000_000)).toBe("1.00000000");
    expect(formatSatoshis(1)).toBe("0.00000001");
    expect(fmtBtc(12345)).toBe("₿ 0.000123");
    expect(fmtBtc(12345, 8)).toBe("₿ 0.00012345");
  });
});

describe("fmtUsd", () => {
  it("shows cents under $100 and whole dollars from there", () => {
    expect(fmtUsd(12.345)).toBe("$12.35");
    expect(fmtUsd(1234.5)).toBe("$1,235");
    expect(fmtUsd(Number.NaN)).toBe("$0");
  });
});

describe("maskDigits", () => {
  it("leaves the value alone while the balance is visible", () => {
    expect(maskDigits("රු. 32,000.00", true)).toBe("රු. 32,000.00");
  });

  it("hides the digits and keeps the symbol and unit", () => {
    expect(maskDigits("රු. 32,000.00", false)).toBe("රු. ****");
    expect(maskDigits("214K sats", false)).toBe("**** sats");
    expect(maskDigits("රු. 29.5M", false)).toBe("රු. ****");
    expect(maskDigits("≈ රු. 1,500.50", false)).toBe("≈ රු. ****");
    expect(maskDigits("+5,000 sats", false)).toBe("+**** sats");
    expect(maskDigits("₿ 0.000123 BTC", false)).toBe("₿ **** BTC");
    expect(maskDigits("USD 98.4K", false)).toBe("USD ****");
  });
});

describe("dates", () => {
  // 26 Nov 2026, 10:00 in Colombo (UTC+05:30)
  const NOW = new Date("2026-11-26T04:30:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs in Sri Lanka time", () => {
    expect(new Date("2026-11-26T04:30:00Z").getHours()).toBe(10);
  });

  it("formats a short date", () => {
    expect(fmtShortDate("2026-03-17T11:30:00Z")).toBe("17 Mar 2026");
  });

  it("uses the Colombo day for a time late in the UTC day", () => {
    // 19:00 UTC is 00:30 the next day in Colombo
    expect(fmtShortDate("2026-03-17T19:00:00Z")).toBe("18 Mar 2026");
  });

  it("formats the time on a 12-hour clock", () => {
    expect(fmtActivityTime("2026-03-17T11:30:00Z")).toBe("05:00 PM");
    expect(fmtActivityDateTime("2026-03-17T11:30:00Z")).toBe("17 Mar 2026 at 05:00 PM");
  });

  it("labels activity groups by day", () => {
    expect(fmtActivityGroupLabel("2026-11-26T01:00:00Z")).toBe("Today");
    expect(fmtActivityGroupLabel("2026-11-25T10:00:00Z")).toBe("Yesterday");
    expect(fmtActivityGroupLabel("2026-04-15T10:00:00Z")).toBe("15 April 2026");
  });

  it("describes a date relative to now", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(fmtRelativeDays(NOW)).toBe("Today");
    expect(fmtRelativeDays(new Date(NOW.getTime() + day))).toBe("In 1 day");
    expect(fmtRelativeDays(new Date(NOW.getTime() + 5 * day))).toBe("In 5 days");
    expect(fmtRelativeDays(new Date(NOW.getTime() - day))).toBe("1 day ago");
    expect(fmtRelativeDays(new Date(NOW.getTime() - 2 * day))).toBe("2 days ago");
  });
});
