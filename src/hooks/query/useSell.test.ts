import { describe, expect, it } from "vitest";
import { sellOrderPollInterval, type SellStatus } from "@/hooks/query/useSell";

describe("sellOrderPollInterval", () => {
  it("doesn't poll before the order has loaded", () => {
    expect(sellOrderPollInterval(undefined)).toBe(false);
  });

  it("polls every 3s while the user approves the payment", () => {
    expect(sellOrderPollInterval("COLLECTING")).toBe(3_000);
  });

  it.each<SellStatus>(["QUOTED", "SATS_COLLECTED", "PAYOUT_PENDING", "REFUNDING"])(
    "polls every 5s while the order is %s",
    (status) => {
      expect(sellOrderPollInterval(status)).toBe(5_000);
    }
  );

  it("polls every 15s while a human checks the order", () => {
    expect(sellOrderPollInterval("NEEDS_REVIEW")).toBe(15_000);
  });

  it.each<SellStatus>(["COMPLETED", "REFUNDED", "EXPIRED"])(
    "stops once the order is %s",
    (status) => {
      expect(sellOrderPollInterval(status)).toBe(false);
    }
  );
});
