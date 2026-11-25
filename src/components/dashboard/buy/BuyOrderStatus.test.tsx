// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { setPlatform, webPlatform } from "@/test/platform";
import { createTestQueryClient, renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import { celebrate } from "@/lib/celebrate";
import type { BuyOrder } from "@/hooks/query/useBuy";
import { BuyOrderStatus } from "@/components/dashboard/buy/BuyOrderStatus";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn() }));

startBackend();

const ID = "0b5c9a52-7d1e-4a43-9f0e-2b6f1c8d3e4a";
const DONT_PAY_AGAIN =
  "If you paid, it will show in Activity once confirmed. Please don't pay again.";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A 5,000 rupee checkout opened a moment ago */
const order = (over: Partial<BuyOrder> = {}): BuyOrder => ({
  order_id: ID,
  amount_lkr: 5000,
  currency: "LKR",
  created_at: minutesAgo(1),
  status: "AWAITING_PAYMENT",
  payhere_pay_id: null,
  satoshis: null,
  settled: false,
  held: false,
  expires_at: new Date(Date.now() + 14 * 60_000).toISOString(),
  ...over,
});

function show(
  reply: BuyOrder | (() => Response),
  { orderId = ID, cancelled = false, embedded = false } = {}
) {
  const requests = backend("GET", `/buy/orders/${orderId}`, reply as never);
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderScreen(
    <BuyOrderStatus orderId={orderId} cancelled={cancelled} embedded={embedded} />,
    { queryClient }
  );
  const invalidated = () => invalidate.mock.calls.map(([filter]) => filter?.queryKey);
  return { ...view, requests, invalidated };
}

const heading = (name: string) => screen.findByRole("heading", { name });
const hasBuyAgain = () => screen.queryByRole("button", { name: "Buy again" }) !== null;

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/payment/success");
  router.push.mockReset();
  vi.mocked(celebrate).mockReset();
  await signInWeb();
});

describe("BuyOrderStatus", () => {
  describe("while the payment is on its way", () => {
    it("waits for PayHere, and keeps checking", async () => {
      show(order());
      expect(await heading("Waiting for PayHere")).toBeTruthy();
      expect(
        screen.getByText(/waiting for PayHere to confirm your රු\. 5,000\.00 payment/)
      ).toBeTruthy();
      expect(screen.getByText("Amount")).toBeTruthy();
      expect(screen.getByText("Pay with")).toBeTruthy();
      // not final: no offer to buy again, which would pay twice
      expect(hasBuyAgain()).toBe(false);
    });

    it("says a pending payment is still processing", async () => {
      show(order({ status: "PENDING" }));
      expect(await heading("Payment pending")).toBeTruthy();
      expect(hasBuyAgain()).toBe(false);
    });

    it("says the sats are being sent once PayHere confirmed", async () => {
      show(order({ status: "SUCCESS", satoshis: 16_000 }));
      expect(await heading("Payment received")).toBeTruthy();
      expect(screen.getByText("Sending 16,000 sats to your wallet…")).toBeTruthy();
      expect(screen.getByText("Amount paid")).toBeTruthy();
      expect(celebrate).not.toHaveBeenCalled();
    });

    it("says a held payment is under review, and doesn't offer to buy again", async () => {
      show(order({ status: "SUCCESS", held: true, satoshis: 16_000 }));
      expect(await heading("Payment under review")).toBeTruthy();
      expect(screen.getByText(/our team is checking it before sending your sats/)).toBeTruthy();
      expect(screen.getByText("Checked by our team")).toBeTruthy();
      expect(hasBuyAgain()).toBe(false);
    });
  });

  describe("done", () => {
    it("celebrates once, shows the sats and refreshes the wallet and history", async () => {
      const { invalidated, rerender } = show(
        order({ status: "SUCCESS", settled: true, satoshis: 16_000 })
      );

      expect(await screen.findByText("+16,000 sats")).toBeTruthy();
      expect(screen.getByText("Bought for රු. 5,000.00 and added to your wallet")).toBeTruthy();
      expect(screen.getByText("Sats added")).toBeTruthy();
      await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
      expect(invalidated()).toEqual([["wallet-summary"], ["transactions"], ["bot-transactions"]]);
      expect(hasBuyAgain()).toBe(false);

      rerender(<BuyOrderStatus orderId={ID} cancelled={false} />);
      expect(celebrate).toHaveBeenCalledTimes(1);
    });

    it("goes to the wallet", async () => {
      const { user } = show(order({ status: "SUCCESS", settled: true, satoshis: 16_000 }));
      await screen.findByText("+16,000 sats");
      await user.click(screen.getByRole("button", { name: "Go to wallet" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard");
    });
  });

  describe("not paid", () => {
    it("says the payment was cancelled when the member came back from PayHere's cancel", async () => {
      const { user } = show(order(), { cancelled: true });
      expect(await heading("Payment cancelled")).toBeTruthy();
      expect(
        screen.getByText("Your රු. 5,000.00 buy was not completed. You can try again anytime.")
      ).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Buy again" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/buy");
    });

    it("says no payment was received once the checkout is long past its time", async () => {
      show(order({ created_at: minutesAgo(40), expires_at: minutesAgo(25) }));
      expect(await heading("No payment received")).toBeTruthy();
      expect(
        screen.getByText(/If you did pay, it will show in Activity once confirmed/)
      ).toBeTruthy();
    });

    it("keeps waiting inside the grace period after the checkout's time", async () => {
      // PayHere can still confirm for 10 minutes after it expires
      show(order({ created_at: minutesAgo(20), expires_at: minutesAgo(5) }));
      expect(await heading("Waiting for PayHere")).toBeTruthy();
    });

    it.each([
      [
        "FAILED",
        "Payment failed",
        "Your රු. 5,000.00 payment didn't go through. Nothing was charged.",
      ],
      [
        "CANCELLED",
        "Payment cancelled",
        "Your රු. 5,000.00 payment was cancelled. Nothing was charged.",
      ],
    ] as const)("when it is %s, says nothing was charged", async (status, title, text) => {
      show(order({ status }));
      expect(await heading(title)).toBeTruthy();
      expect(screen.getByText(text)).toBeTruthy();
      expect(hasBuyAgain()).toBe(true);
    });

    it("says a reversed payment was reversed, and doesn't offer to buy again", async () => {
      show(order({ status: "CHARGEBACK", satoshis: 16_000 }));
      expect(await heading("Payment reversed")).toBeTruthy();
      expect(screen.getByText("Amount paid")).toBeTruthy();
      expect(hasBuyAgain()).toBe(false);
    });
  });

  describe("when it can't tell", () => {
    it("claims nothing about the money for a status it doesn't know", async () => {
      show(order({ status: "REFUND_REQUESTED" as BuyOrder["status"] }));
      expect(await heading("Payment status unknown")).toBeTruthy();
      expect(
        screen.getByText("We couldn't confirm this payment. Check Activity or contact support.")
      ).toBeTruthy();
    });

    it("says the purchase wasn't found, and not to pay again", async () => {
      const { requests } = show(failWith(404, "Not found"));
      expect(await heading("Purchase not found")).toBeTruthy();
      expect(screen.getByText(`We couldn't find this purchase. ${DONT_PAY_AGAIN}`)).toBeTruthy();
      // a 404 won't change by asking again
      expect(requests).toHaveLength(1);
    });

    it.each(["abc", "../../user/me", "1; DROP TABLE orders", ""])(
      "never asks the backend for the id %j",
      async (orderId) => {
        const anyOrder = backend("GET", "/buy/orders/:id", order());
        renderScreen(<BuyOrderStatus orderId={orderId} cancelled={false} />);
        expect(await heading("Purchase not found")).toBeTruthy();
        expect(anyOrder).toHaveLength(0);
      }
    );

    it(
      "offers a retry when the purchase can't be loaded, and says not to pay again",
      { timeout: 20_000 },
      async () => {
        const { user, requests } = show(failWith(503, "Down"));
        // asked four times, with pauses, before giving up
        expect(
          await screen.findByRole(
            "heading",
            { name: "Couldn't load your purchase" },
            { timeout: 12_000 }
          )
        ).toBeTruthy();
        expect(
          screen.getByText(`Check your connection and try again. ${DONT_PAY_AGAIN}`)
        ).toBeTruthy();

        backend("GET", `/buy/orders/${ID}`, order({ status: "PENDING" }));
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(await heading("Payment pending")).toBeTruthy();
        expect(requests.length).toBeGreaterThan(1);
      }
    );

    it("asks the member to sign in when the session ended while they were paying", async () => {
      signOut();
      const { user, requests } = show(order());
      expect(await heading("Sign in to see your purchase")).toBeTruthy();
      expect(screen.getByText(new RegExp(DONT_PAY_AGAIN))).toBeTruthy();
      expect(requests).toHaveLength(0);

      await user.click(screen.getByRole("button", { name: "Sign in" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/");
    });
  });

  describe("inside the dashboard", () => {
    it("has a header that goes back to the wallet", async () => {
      const { user } = show(order(), { embedded: true });
      expect(await screen.findByRole("heading", { name: "Purchase" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /back/i }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard");
    });
  });
});
