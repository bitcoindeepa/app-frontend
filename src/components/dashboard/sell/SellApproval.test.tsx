// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { stubLocation } from "@/test/dom";
import { passkeyStatus, sellOrder } from "@/test/fixtures";
import { telegramPlatform, setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { getSessionSnapshot } from "@/lib/auth";
import type { SellCollect, SellOrder } from "@/hooks/query/useSell";
import { collectView, SellApproval } from "@/components/dashboard/sell/SellApproval";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** A sale waiting for its payment */
const waiting = (collect: Partial<SellCollect> = {}, over: Partial<SellOrder> = {}) =>
  sellOrder({
    collect: { state: "pending", expiresAt: inMinutes(5), payInApp: true, ...collect },
    ...over,
  });

const payButton = () =>
  screen.getByRole("button", { name: "Pay 100,000 sats" }) as HTMLButtonElement;

/** The web: the member has a passkey, and approves the prompt */
function withPasskey() {
  backend("GET", "/passkey", passkeyStatus());
  return backend("POST", "/passkey/approve/options", { challenge: "abc" });
}

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard/sell/ord_1");
  authenticate.mockReset().mockResolvedValue({ id: "cred-1" } as never);
  await signInWeb();
});

describe("SellApproval", () => {
  describe("what it offers", () => {
    it("lets the member pay in the app, open the bot chat, or cancel", () => {
      renderScreen(<SellApproval order={waiting()} />);
      expect(payButton().disabled).toBe(false);
      expect(screen.getByRole("button", { name: "Open the bot chat" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel sale" })).toBeTruthy();
      expect(screen.getByText(/5:00 left to approve/)).toBeTruthy();
    });

    it("only points to the bot chat when the backend doesn't allow paying in the app", async () => {
      const platform = setPlatform(webPlatform());
      const { user } = renderScreen(<SellApproval order={waiting({ payInApp: false })} />);
      expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Open the bot chat" }));
      expect(platform.openTelegramLink).toHaveBeenCalledExactlyOnceWith(
        "https://t.me/BitcoinDeepaBot"
      );
    });

    it("can't be paid or cancelled here once it waits for Confirm in the bot chat", () => {
      renderScreen(<SellApproval order={waiting({ state: "awaiting_confirmation" })} />);
      expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
      expect(screen.queryByRole("button", { name: "Cancel sale" })).toBeNull();
      expect(screen.getByRole("button", { name: "Open the bot chat" })).toBeTruthy();
    });

    it.each(["requesting", "processing", "in_flight", "completed"] as const)(
      "shows no actions while the payment is %s",
      (state) => {
        const { container } = renderScreen(<SellApproval order={waiting({ state })} />);
        expect(container.querySelector("button")).toBeNull();
      }
    );

    it("shows no actions for a sale with no payment to approve", () => {
      const { container } = renderScreen(<SellApproval order={sellOrder({ collect: null })} />);
      expect(container.querySelector("button")).toBeNull();
    });

    it("can't be paid once the time to approve has run out", () => {
      renderScreen(<SellApproval order={waiting({ expiresAt: inMinutes(-1) })} />);
      expect(payButton().disabled).toBe(true);
      expect(screen.queryByText(/left to approve/)).toBeNull();
    });
  });

  describe("paying on the web", () => {
    it("asks for the passkey for this order, then pays", async () => {
      const approvals = withPasskey();
      const payments = backend(
        "POST",
        "/sell/orders/ord_1/pay",
        sellOrder({ status: "SATS_COLLECTED" })
      );
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      await waitFor(() => expect(payments).toHaveLength(1));
      expect(approvals[0].body).toEqual({ action: "sell_pay", order_id: "ord_1" });
      expect(payments[0].headers.has("X-Passkey-Assertion")).toBe(true);
    });

    it("says “Not paid”, and pays nothing, when the member closes the passkey prompt", async () => {
      withPasskey();
      const payments = backend("POST", "/sell/orders/ord_1/pay", sellOrder());
      const cancelled = new Error("Not allowed");
      cancelled.name = "NotAllowedError";
      authenticate.mockRejectedValue(cancelled);
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      expect(await screen.findByText("Not paid")).toBeTruthy();
      expect(payments).toHaveLength(0);
      // nothing was sent, so it must not suggest the payment might have gone through
      expect(screen.queryByText("Checking your payment")).toBeNull();
    });

    it("says the payment wasn't approved when the backend refuses the approval", async () => {
      backend("GET", "/passkey", passkeyStatus());
      backend("POST", "/passkey/approve/options", failWith(403, "This sale has expired"));
      const payments = backend("POST", "/sell/orders/ord_1/pay", sellOrder());
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      expect(await screen.findByText("Payment not approved")).toBeTruthy();
      expect(screen.getByText("This sale has expired")).toBeTruthy();
      expect(payments).toHaveLength(0);
    });

    it("asks the member to log in again on relogin_required, without signing them out", async () => {
      withPasskey();
      backend("POST", "/sell/orders/ord_1/pay", failWith(403, "Log in again", "relogin_required"));
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      expect(await screen.findByRole("dialog", { name: "Log in to pay" })).toBeTruthy();
      expect(getSessionSnapshot().status).toBe("authenticated");
    });

    it("says it is checking when the answer never came: the payment may have gone through", async () => {
      withPasskey();
      backend("POST", "/sell/orders/ord_1/pay", failWith(504, "Gateway timeout"));
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      expect(await screen.findByText("Checking your payment")).toBeTruthy();
      expect(screen.queryByText("Payment failed")).toBeNull();
    });

    it("says the payment failed, with the reason, when the backend refuses it", async () => {
      withPasskey();
      backend("POST", "/sell/orders/ord_1/pay", failWith(400, "Not enough sats in your wallet"));
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      expect(await screen.findByText("Payment failed")).toBeTruthy();
      expect(screen.getByText("Not enough sats in your wallet")).toBeTruthy();
    });
  });

  describe("paying in the Mini App", () => {
    it("pays without a passkey step", async () => {
      signOut();
      setPlatform(telegramPlatform());
      await signInMiniApp();
      const payments = backend(
        "POST",
        "/sell/orders/ord_1/pay",
        sellOrder({ status: "SATS_COLLECTED" })
      );
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      await waitFor(() => expect(payments).toHaveLength(1));
      expect(payments[0].headers.has("X-Passkey-Assertion")).toBe(false);
      expect(authenticate).not.toHaveBeenCalled();
    });

    it("asks the member to reopen the app on relogin_required", async () => {
      signOut();
      setPlatform(telegramPlatform());
      await signInMiniApp();
      backend("POST", "/sell/orders/ord_1/pay", failWith(403, "Log in again", "relogin_required"));
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(payButton());

      expect(await screen.findByRole("dialog", { name: "Reopen to pay" })).toBeTruthy();
    });
  });

  describe("cancelling", () => {
    it("cancels the sale after the member confirms", async () => {
      const platform = setPlatform(webPlatform());
      const cancels = backend(
        "POST",
        "/sell/orders/ord_1/cancel",
        sellOrder({ status: "EXPIRED" })
      );
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(screen.getByRole("button", { name: "Cancel sale" }));

      await waitFor(() => expect(cancels).toHaveLength(1));
      expect(platform.confirm).toHaveBeenCalledExactlyOnceWith({
        title: "Cancel sale",
        message: "Cancel this sale? Nothing will be sold.",
        confirmText: "Cancel sale",
      });
    });

    it("cancels nothing when the member says no", async () => {
      setPlatform(webPlatform({ confirm: vi.fn(async () => false) }));
      const cancels = backend("POST", "/sell/orders/ord_1/cancel", sellOrder());
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(screen.getByRole("button", { name: "Cancel sale" }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(cancels).toHaveLength(0);
    });

    it("says why when the sale can't be cancelled", async () => {
      backend(
        "POST",
        "/sell/orders/ord_1/cancel",
        failWith(409, "This sale is already being paid")
      );
      const { user } = renderScreen(<SellApproval order={waiting()} />);

      await user.click(screen.getByRole("button", { name: "Cancel sale" }));

      expect(await screen.findByText("Couldn't cancel")).toBeTruthy();
      expect(screen.getByText("This sale is already being paid")).toBeTruthy();
    });
  });
});

describe("collectView", () => {
  it("tells the member how to approve, by where they can pay", () => {
    expect(collectView(waiting())).toEqual({
      title: "Approve the payment",
      text: "Pay 100,000 sats from your wallet to finish this sale. You can also tap ✅ Pay in the bot chat.",
      waiting: true,
    });
    expect(collectView(waiting({ payInApp: false })).text).toBe(
      "Tap ✅ Pay in the Bitcoin Deepa bot chat to send 100,000 sats and finish this sale."
    );
  });

  it("explains the other states", () => {
    expect(collectView(waiting({ state: "awaiting_confirmation" }))).toMatchObject({
      title: "Confirm in the bot chat",
      waiting: true,
    });
    expect(collectView(waiting({ state: "requesting" }))).toMatchObject({
      title: "Starting your sale",
      waiting: false,
    });
    expect(collectView(waiting({ state: "in_flight" }))).toMatchObject({
      title: "Selling your sats",
      waiting: false,
    });
    expect(collectView(sellOrder({ collect: null }))).toMatchObject({
      title: "Selling your sats",
      waiting: false,
    });
  });
});
