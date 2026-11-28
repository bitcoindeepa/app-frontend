import { describe, expect, it } from "vitest";
import {
  cleanBotMemo,
  getActivityCategory,
  mapBotTransactionToActivityItem,
  mapDcaTransactionToActivityItem,
  mapSellOrderToActivityItem,
} from "@/lib/activity";
import type { BotTransaction } from "@/lib/types";
import type { DcaTransaction } from "@/hooks/query/useTransactionHistory";
import type { SellOrder } from "@/hooks/query/useSell";

const purchase = (over: Partial<DcaTransaction> = {}): DcaTransaction => ({
  id: "pay_1",
  created_at: "2026-11-20T08:00:00Z",
  satoshis_purchased: 32_000,
  btc_price_at_purchase: 30_000_000,
  package_amount: 10_000,
  gross_amount: 10_000,
  net_amount: 9_600,
  package_name: "Shrimp",
  kind: "RECURRING",
  status: "SUCCESS",
  settled: true,
  ...over,
});

const sale = (over: Partial<SellOrder> = {}): SellOrder => ({
  id: "ord_1",
  status: "COMPLETED",
  sats: 100_000,
  feeBasisPoints: 150,
  grossLkr: 30_000,
  feeLkr: 450,
  bankChargeLkr: 50,
  btcLkrRate: 30_000_000,
  amountLkr: 29_500,
  expiresAt: "2026-11-20T08:01:00Z",
  bankRef: null,
  failureReason: null,
  createdAt: "2026-11-20T08:00:00Z",
  completedAt: "2026-11-20T09:00:00Z",
  collect: null,
  ...over,
});

const transfer = (over: Partial<BotTransaction> = {}): BotTransaction => ({
  id: 42,
  time: "2026-11-20T08:00:00Z",
  direction: "outgoing",
  from_id: 1,
  to_id: 2,
  from_user: "telegram_alice",
  to_user: "telegram_bob",
  type: "internal",
  amount: 5_000,
  amount_lkr: "1,500.50",
  success: true,
  status: "success",
  counterparty_username: "bob",
  ...over,
});

describe("getActivityCategory", () => {
  it("sorts each type into its tab", () => {
    expect(getActivityCategory("tasks_reward")).toBe("tasks");
    expect(getActivityCategory("membership_reward")).toBe("plans");
    expect(getActivityCategory("sent")).toBe("transactions");
    expect(getActivityCategory("gift_received")).toBe("transactions");
    expect(getActivityCategory("bitcoin_sale")).toBe("transactions");
  });

  it("counts a one-time buy as a transaction, not a plan", () => {
    expect(getActivityCategory("bitcoin_purchase")).toBe("transactions");
  });
});

describe("mapDcaTransactionToActivityItem", () => {
  it("maps a settled plan charge", () => {
    expect(mapDcaTransactionToActivityItem(purchase())).toEqual({
      id: "pay_1",
      type: "membership_reward",
      detailLabel: "Shrimp Plan",
      timestamp: "2026-11-20T08:00:00Z",
      sats: 32_000,
      lkr: 10_000,
      statusDot: "green",
      notCredited: false,
      settlement: {
        status: "Settled",
        settledOn: "2026-11-20T08:00:00Z",
        btcSats: 32_000,
        btcPriceLkr: 30_000_000,
        feeLkr: 400,
        transactionId: "pay_1",
      },
    });
  });

  it("maps a one-time buy", () => {
    const item = mapDcaTransactionToActivityItem(purchase({ kind: "ONE_TIME" }));
    expect(item.type).toBe("bitcoin_purchase");
    expect(item.detailLabel).toBe("One-time Buy");
  });

  it("labels a plan charge without a plan name", () => {
    const item = mapDcaTransactionToActivityItem(purchase({ package_name: undefined }));
    expect(item.detailLabel).toBe("Distributed");
  });

  it("shows a paid purchase as processing until its sats are sent", () => {
    const item = mapDcaTransactionToActivityItem(purchase({ settled: false }));
    expect(item.statusDot).toBe("orange");
    expect(item.settlement.status).toBe("Processing");
    expect(item.notCredited).toBe(false);
  });

  it.each([
    ["PENDING", "orange", "Pending", false],
    ["CANCELLED", "gray", "Cancelled", true],
    ["FAILED", "red", "Failed", true],
    ["CHARGEBACK", "red", "Chargeback", true],
  ])("maps the status %s", (status, dot, label, notCredited) => {
    const item = mapDcaTransactionToActivityItem(purchase({ status, settled: false }));
    expect(item.statusDot).toBe(dot);
    expect(item.settlement.status).toBe(label);
    expect(item.notCredited).toBe(notCredited);
  });

  it("reads the status in any case", () => {
    const item = mapDcaTransactionToActivityItem(purchase({ status: "failed" }));
    expect(item.settlement.status).toBe("Failed");
    expect(item.notCredited).toBe(true);
  });

  it("shows a status it doesn't know as it came", () => {
    const item = mapDcaTransactionToActivityItem(purchase({ status: "REVERSED" }));
    expect(item.statusDot).toBe("gray");
    expect(item.settlement.status).toBe("REVERSED");
  });

  it("shows no fee rather than a wrong one", () => {
    // older rows have no net amount
    expect(
      mapDcaTransactionToActivityItem(purchase({ net_amount: 0 })).settlement.feeLkr
    ).toBeUndefined();
    expect(
      mapDcaTransactionToActivityItem(purchase({ net_amount: 12_000 })).settlement.feeLkr
    ).toBeUndefined();
  });
});

describe("mapSellOrderToActivityItem", () => {
  it("maps a paid sale as sats out and rupees in", () => {
    expect(mapSellOrderToActivityItem(sale(), "rent")).toEqual({
      id: "sell-ord_1",
      type: "bitcoin_sale",
      detailLabel: "Sold to bank",
      timestamp: "2026-11-20T08:00:00Z",
      sats: -100_000,
      lkr: 29_500,
      statusDot: "green",
      notCredited: false,
      settlement: {
        status: "Paid",
        settledOn: "2026-11-20T09:00:00Z",
        btcSats: 100_000,
        btcPriceLkr: 30_000_000,
        memo: "rent",
        transactionId: "ord_1",
      },
    });
  });

  it("uses the created time until the sale completes", () => {
    const item = mapSellOrderToActivityItem(sale({ status: "PAYOUT_PENDING", completedAt: null }));
    expect(item.settlement.settledOn).toBe("2026-11-20T08:00:00Z");
    expect(item.statusDot).toBe("orange");
    expect(item.settlement.status).toBe("Processing");
    expect(item.settlement.memo).toBeUndefined();
  });

  it("marks a refunded sale as not taken", () => {
    const item = mapSellOrderToActivityItem(sale({ status: "REFUNDED" }));
    expect(item.notCredited).toBe(true);
    expect(item.statusDot).toBe("red");
    expect(item.settlement.status).toBe("Refunded");
  });

  it("shows a status it doesn't know as it came", () => {
    const item = mapSellOrderToActivityItem(sale({ status: "ON_HOLD" as SellOrder["status"] }));
    expect(item.statusDot).toBe("gray");
    expect(item.settlement.status).toBe("ON_HOLD");
  });
});

describe("cleanBotMemo", () => {
  it("keeps only the note from a memo the bot wrapped", () => {
    expect(cleanBotMemo("💸 P2P Send from @a to @b. Memo: lunch")).toBe("lunch");
  });

  it("is empty when the bot's wrapper has no note", () => {
    expect(cleanBotMemo("💰 Collect by @w from @u.")).toBeUndefined();
    expect(cleanBotMemo("💸 P2P Send from @a to @b. Memo:   ")).toBeUndefined();
  });

  it("never shows the Telegram usernames in the wrapper", () => {
    expect(cleanBotMemo("💸 P2P Send from @telegram_alice to @telegram_bob.")).toBeUndefined();
  });

  it("keeps a note the bot didn't wrap", () => {
    expect(cleanBotMemo("Thanks for dinner")).toBe("Thanks for dinner");
    expect(cleanBotMemo("Send me the invoice")).toBe("Send me the invoice");
  });

  it("is empty without a memo", () => {
    expect(cleanBotMemo(undefined)).toBeUndefined();
    expect(cleanBotMemo("")).toBeUndefined();
  });
});

describe("mapBotTransactionToActivityItem", () => {
  it("maps a send to another member", () => {
    expect(
      mapBotTransactionToActivityItem(
        transfer({ memo: "💸 P2P Send from @telegram_alice to @telegram_bob. Memo: lunch" })
      )
    ).toEqual({
      id: "bot-42",
      type: "sent",
      counterparty: "bob",
      detailLabel: undefined,
      lightning: false,
      timestamp: "2026-11-20T08:00:00Z",
      sats: -5_000,
      lkr: 1500.5,
      statusDot: "green",
      notCredited: false,
      settlement: {
        status: "Completed",
        settledOn: "2026-11-20T08:00:00Z",
        btcSats: 5_000,
        feeSats: undefined,
        memo: "lunch",
        transactionId: "42",
      },
    });
  });

  it("maps a receipt as sats in", () => {
    const item = mapBotTransactionToActivityItem(transfer({ direction: "incoming" }));
    expect(item.type).toBe("received");
    expect(item.sats).toBe(5_000);
  });

  it("shows our @username only, never the Telegram one", () => {
    expect(
      mapBotTransactionToActivityItem(transfer({ counterparty_username: "@bob" })).counterparty
    ).toBe("bob");
    expect(
      mapBotTransactionToActivityItem(transfer({ counterparty_username: null })).counterparty
    ).toBeUndefined();
  });

  it.each([
    ["1,234.50", 1234.5],
    [1234.5, 1234.5],
    [null, 0],
    ["not a number", 0],
    [Number.NaN, 0],
  ])("reads the rupee amount %j", (amount_lkr, expected) => {
    expect(mapBotTransactionToActivityItem(transfer({ amount_lkr })).lkr).toBe(expected);
  });

  it("maps a pending transfer", () => {
    const item = mapBotTransactionToActivityItem(transfer({ status: "pending", success: false }));
    expect(item.statusDot).toBe("orange");
    expect(item.settlement.status).toBe("Pending");
    expect(item.notCredited).toBe(false);
  });

  it("marks a failed transfer as not sent", () => {
    const item = mapBotTransactionToActivityItem(transfer({ status: "failed", success: false }));
    expect(item.statusDot).toBe("red");
    expect(item.settlement.status).toBe("Failed");
    expect(item.notCredited).toBe(true);
  });

  it("falls back to `success` on a backend that sends no status", () => {
    const ok = mapBotTransactionToActivityItem(transfer({ status: undefined, success: true }));
    expect(ok.settlement.status).toBe("Completed");
    expect(ok.notCredited).toBe(false);

    const failed = mapBotTransactionToActivityItem(transfer({ status: undefined, success: false }));
    expect(failed.settlement.status).toBe("Failed");
    expect(failed.notCredited).toBe(true);
  });

  describe("Lightning", () => {
    const lightning = (over: Partial<BotTransaction> = {}) =>
      transfer({ id: 0, type: "lightning", payment_hash: "abc123", fee: 3, ...over });

    it("is keyed by its payment hash, as every Lightning row has id 0", () => {
      const item = mapBotTransactionToActivityItem(lightning());
      expect(item.id).toBe("bot-abc123");
      expect(item.settlement.transactionId).toBe("abc123");
      expect(item.lightning).toBe(true);
    });

    it("falls back to the time and amount without a payment hash", () => {
      const item = mapBotTransactionToActivityItem(lightning({ payment_hash: undefined }));
      expect(item.id).toBe("bot-2026-11-20T08:00:00Z-5000");
    });

    it("has no other member", () => {
      expect(mapBotTransactionToActivityItem(lightning()).counterparty).toBeUndefined();
    });

    it("shows the payer's note in the label", () => {
      expect(mapBotTransactionToActivityItem(lightning()).detailLabel).toBe("Lightning");
      expect(mapBotTransactionToActivityItem(lightning({ memo: "coffee" })).detailLabel).toBe(
        "Lightning · coffee"
      );
    });

    it("shows the network fee on a payment out only", () => {
      expect(mapBotTransactionToActivityItem(lightning()).settlement.feeSats).toBe(3);
      expect(
        mapBotTransactionToActivityItem(lightning({ direction: "incoming" })).settlement.feeSats
      ).toBeUndefined();
      expect(
        mapBotTransactionToActivityItem(lightning({ fee: 0 })).settlement.feeSats
      ).toBeUndefined();
    });
  });
});
