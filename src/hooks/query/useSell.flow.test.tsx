// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { Platform } from "@/platform/types";
import { telegramPlatform, webPlatform } from "@/test/platform";
import { createTestQueryClient, failure, renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { PasskeyStepError } from "@/lib/passkey";
import {
  useCancelSell,
  useConfirmSell,
  usePaySell,
  useSellOrder,
  useSellQuote,
  type SellOrder,
} from "@/hooks/query/useSell";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);

const order = (over: Partial<SellOrder> = {}): SellOrder => ({
  id: "ord_1",
  status: "COLLECTING",
  sats: 100_000,
  feeBasisPoints: 150,
  grossLkr: 30_000,
  feeLkr: 450,
  bankChargeLkr: 50,
  btcLkrRate: 30_000_000,
  amountLkr: 29_500,
  expiresAt: "2026-11-26T04:31:00Z",
  bankRef: null,
  failureReason: null,
  createdAt: "2026-11-26T04:30:00Z",
  completedAt: null,
  collect: null,
  ...over,
});

const PASSKEY = {
  enabled: true,
  unlocked: true,
  available: true,
  lock_on_open: true,
  passkeys: [],
};

/** What a sale's payment changes: the wallet, the spendable balance, history and orders */
const AFTER_SALE = [
  ["wallet-summary"],
  ["p2p", "me"],
  ["bot-transactions"],
  ["transactions"],
  ["sell", "orders"],
];

function withClient<Result>(hook: () => Result) {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHookWithClient(hook, { queryClient });
  const invalidated = () => invalidate.mock.calls.map(([filter]) => filter?.queryKey);
  return { ...view, invalidated };
}

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ id: "cred-1" } as never);
});

describe("usePaySell", () => {
  describe("on the web", () => {
    beforeEach(async () => {
      platform.current = webPlatform();
      await signInWeb();
    });

    it("has the member approve this order with a passkey, then pays it", async () => {
      backend("GET", "/passkey", PASSKEY);
      const approvals = backend("POST", "/passkey/approve/options", { challenge: "abc" });
      const payments = backend(
        "POST",
        "/sell/orders/ord_1/pay",
        order({ status: "SATS_COLLECTED" })
      );
      const { result, queryClient, invalidated } = withClient(() => usePaySell("ord_1"));

      await act(() => result.current.mutateAsync());

      expect(approvals[0].body).toEqual({ action: "sell_pay", order_id: "ord_1" });
      expect(payments).toHaveLength(1);
      expect(payments[0].body).toBeUndefined();
      expect(payments[0].headers.get("X-Passkey-Assertion")).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(queryClient.getQueryData<SellOrder>(["sell", "orders", "ord_1"])?.status).toBe(
        "SATS_COLLECTED"
      );
      expect(invalidated()).toEqual(AFTER_SALE);
    });

    it("pays nothing when the member closes the passkey prompt", async () => {
      backend("GET", "/passkey", PASSKEY);
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      const payments = backend("POST", "/sell/orders/ord_1/pay", order());
      const cancelled = new Error("Not allowed");
      cancelled.name = "NotAllowedError";
      authenticate.mockRejectedValue(cancelled);
      const { result } = withClient(() => usePaySell("ord_1"));

      const error = await failure(() => result.current.mutateAsync());

      expect(error).toBeInstanceOf(PasskeyStepError);
      expect(payments).toHaveLength(0);
    });

    it("refreshes everything after a payment that failed: it may still have gone through", async () => {
      backend("GET", "/passkey", PASSKEY);
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      backend("POST", "/sell/orders/ord_1/pay", failWith(502, "Bot unreachable"));
      const { result, invalidated } = withClient(() => usePaySell("ord_1"));

      await failure(() => result.current.mutateAsync());

      expect(invalidated()).toEqual(AFTER_SALE);
    });
  });

  describe("in the Mini App", () => {
    it("pays with the session token and no passkey step", async () => {
      signOut();
      platform.current = telegramPlatform();
      await signInMiniApp();
      const payments = backend(
        "POST",
        "/sell/orders/ord_1/pay",
        order({ status: "SATS_COLLECTED" })
      );
      const { result } = withClient(() => usePaySell("ord_1"));

      await act(() => result.current.mutateAsync());

      expect(payments).toHaveLength(1);
      expect(payments[0].headers.get("Authorization")).toBe("Bearer session-token");
      expect(payments[0].headers.has("X-Passkey-Assertion")).toBe(false);
      expect(authenticate).not.toHaveBeenCalled();
    });
  });
});

describe("the rest of a sale", () => {
  beforeEach(async () => {
    signOut();
    platform.current = webPlatform();
    await signInWeb();
  });

  it("asks for a quote in sats", async () => {
    const quotes = backend("POST", "/sell/quote", order({ status: "QUOTED" }));
    const { result } = withClient(() => useSellQuote());
    await act(() => result.current.mutateAsync(100_000));
    expect(quotes[0].body).toEqual({ sats: 100_000 });
  });

  it("confirms a quote without a passkey: nothing is paid yet", async () => {
    const confirms = backend("POST", "/sell/orders/ord_1/confirm", order());
    const { result, queryClient, invalidated } = withClient(() => useConfirmSell());

    await act(() => result.current.mutateAsync("ord_1"));

    expect(confirms).toHaveLength(1);
    expect(authenticate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<SellOrder>(["sell", "orders", "ord_1"])?.status).toBe(
      "COLLECTING"
    );
    expect(invalidated()).toEqual(AFTER_SALE);
  });

  it("refreshes everything after a confirm that failed: the answer may only have been lost", async () => {
    backend("POST", "/sell/orders/ord_1/confirm", failWith(504, "Timed out"));
    const { result, invalidated } = withClient(() => useConfirmSell());
    await failure(() => result.current.mutateAsync("ord_1"));
    expect(invalidated()).toEqual(AFTER_SALE);
  });

  it("cancels a sale that isn't paid yet", async () => {
    const cancels = backend("POST", "/sell/orders/ord_1/cancel", order({ status: "EXPIRED" }));
    const { result, queryClient, invalidated } = withClient(() => useCancelSell("ord_1"));

    await act(() => result.current.mutateAsync());

    expect(cancels).toHaveLength(1);
    expect(queryClient.getQueryData<SellOrder>(["sell", "orders", "ord_1"])?.status).toBe(
      "EXPIRED"
    );
    expect(invalidated()).toEqual(AFTER_SALE);
  });
});

describe("useSellOrder", () => {
  beforeEach(async () => {
    signOut();
    platform.current = webPlatform();
    await signInWeb();
  });

  it("refreshes the balances when the sats leave the wallet", async () => {
    let status: SellOrder["status"] = "COLLECTING";
    backend("GET", "/sell/orders/ord_1", () => order({ status }));
    const { result, queryClient, invalidated } = withClient(() => useSellOrder("ord_1"));
    await waitFor(() => expect(result.current.data?.status).toBe("COLLECTING"));
    expect(invalidated()).toEqual([]);

    // paid, in the app or in the bot chat
    status = "SATS_COLLECTED";
    await act(() => queryClient.refetchQueries({ queryKey: ["sell", "orders", "ord_1"] }));

    await waitFor(() => expect(invalidated()).toEqual([["p2p", "me"], ["wallet-summary"]]));
  });

  it("doesn't refresh them for an order that was never waiting for payment here", async () => {
    backend("GET", "/sell/orders/ord_1", order({ status: "COMPLETED" }));
    const { result, invalidated } = withClient(() => useSellOrder("ord_1"));
    await waitFor(() => expect(result.current.data?.status).toBe("COMPLETED"));
    expect(invalidated()).toEqual([]);
  });
});
