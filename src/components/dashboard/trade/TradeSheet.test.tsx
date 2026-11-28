// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { stubLocation } from "@/test/dom";
import { BTC_LKR, p2pMe, sellOrder, walletSummary } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import type { BankAccount } from "@/hooks/query/useBankAccounts";
import type { BuyPrice } from "@/hooks/query/useBuy";
import type { SellOrder, SellPrice } from "@/hooks/query/useSell";
import TradeSheet from "@/components/dashboard/trade/TradeSheet";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const sheets = vi.hoisted(() => ({ openAddBank: vi.fn(), openSettings: vi.fn() }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/dashboard/sheets", () => ({ useSheets: () => sheets }));
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn() }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);

// Buy: 3% to the payment processor + 1% to Bitcoin Deepa
const BUY_PRICE: BuyPrice = {
  btcLkrPrice: BTC_LKR,
  paymentProcessorFeeBasisPoints: 300,
  bitcoindeepaFeeBasisPoints: 100,
  minLkr: 500,
  maxLkr: 100_000,
  dailyMaxLkr: 250_000,
};

// Sell: 1.5% fee, then a flat 50.00 bank charge
const SELL_PRICE: SellPrice = {
  btcLkrRate: BTC_LKR,
  feeBasisPoints: 150,
  bankChargeLkr: 50,
  minSats: 1_000,
  maxSats: 1_000_000,
};

const bank = (status: BankAccount["status"] = "VERIFIED"): BankAccount => ({
  id: "acc_1",
  bankCode: 7010,
  bankName: "Bank of Ceylon",
  accountNumber: "00123456789",
  accountName: "Nimal Silva",
  status,
  rejectionReason: null,
  createdAt: "2026-11-01T04:00:00Z",
  reviewedAt: null,
});

const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

/** A quote for 100,000 sats: 30,000.00 less 450.00 fee and 50.00 bank charge */
const quote = (over: Partial<SellOrder> = {}) =>
  sellOrder({ status: "QUOTED", expiresAt: inSeconds(60), ...over });

/** What the backend says about the member when the sheet opens */
function member({
  kyc = "APPROVED",
  accounts = [bank()],
  balance = 150_000,
  pots = 0,
  me,
}: {
  kyc?: string;
  accounts?: BankAccount[];
  balance?: number;
  pots?: number;
  me?: () => Response;
} = {}) {
  backend("GET", "/user/kyc/status", { status: kyc });
  backend("GET", "/buy/price", BUY_PRICE);
  backend("GET", "/sell/price", SELL_PRICE);
  backend("GET", "/bank-accounts", accounts);
  backend("GET", "/p2p/me", (me ?? p2pMe({ balance, pot_balance: pots })) as never);
  backend(
    "GET",
    "/transaction/dca-summary",
    walletSummary({
      total_balance: balance + pots,
      spendable_balance: balance,
      pot_balance: pots,
    })
  );
}

async function open(kind: "buy" | "sell") {
  const onOpenChange = vi.fn();
  const view = renderScreen(<TradeSheet open onOpenChange={onOpenChange} initialKind={kind} />);
  await screen.findByRole("dialog", { name: kind === "buy" ? "Buy bitcoin" : "Sell bitcoin" });
  // the price line is the last thing to load
  await screen.findByText(/1 BTC ≈ රු\. 30,000,000\.00/);
  return { ...view, onOpenChange };
}

type User = Awaited<ReturnType<typeof open>>["user"];

const reviewButton = () => screen.getByRole("button", { name: "Review" }) as HTMLButtonElement;
const value = (name: string | RegExp) =>
  (screen.getByRole("textbox", { name }) as HTMLInputElement).value;

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  router.push.mockReset();
  router.replace.mockReset();
  sheets.openAddBank.mockReset();
  authenticate.mockReset();
  await signInWeb();
});

describe("TradeSheet", () => {
  it("opens on the side it was asked for, and switches", async () => {
    member();
    const { user } = await open("buy");
    expect(screen.getByRole("textbox", { name: "You pay" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Sell" }));

    expect(await screen.findByRole("dialog", { name: "Sell bitcoin" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "You sell" })).toBeTruthy();
  });

  it("keeps each side's amount when switching back and forth", async () => {
    member();
    const { user } = await open("buy");
    await user.type(screen.getByRole("textbox", { name: "You pay" }), "5000");

    await user.click(screen.getByRole("button", { name: "Sell" }));
    await user.type(screen.getByRole("textbox", { name: "You sell" }), "2000");
    await user.click(screen.getByRole("button", { name: "Buy" }));

    // a rupee amount that isn't being typed reads with two decimals
    expect(value("You pay")).toBe("5,000.00");
  });
});

describe("Buy", () => {
  const payField = () => screen.getByRole("textbox", { name: "You pay" });

  async function review(user: User, lkr = "5000") {
    await user.type(payField(), lkr);
    await user.click(reviewButton());
    await screen.findByRole("dialog", { name: "Review purchase" });
  }

  /** Catches the form PayHere is opened with (jsdom can't navigate) */
  function payHere() {
    const opened: { action: string; method: string; fields: Record<string, string> }[] = [];
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
      this: HTMLFormElement
    ) {
      opened.push({
        action: this.action,
        method: this.method,
        fields: Object.fromEntries(
          [...this.querySelectorAll("input")].map((input) => [input.name, input.value])
        ),
      });
    });
    return opened;
  }

  describe("the amount", () => {
    it("takes rupees and estimates the sats after fees", async () => {
      member();
      const { user } = await open("buy");
      expect(screen.getByText("From රු. 500.00 · up to රු. 100,000.00 at a time")).toBeTruthy();
      expect(screen.getByText("1 BTC ≈ රු. 30,000,000.00 · 4% fee")).toBeTruthy();

      await user.type(payField(), "5000");

      // 5,000 less 4% is 4,800, which buys 16,000 sats at 30M
      expect(screen.getByRole("status", { name: "You get (estimate)" }).textContent).toBe(
        "≈ 16,000 sats"
      );
      expect(reviewButton().disabled).toBe(false);
    });

    it.each([
      ["499", "Minimum is රු. 500.00"],
      ["100001", "Maximum per buy is රු. 100,000.00"],
    ])("refuses %s rupees", async (typed, message) => {
      member();
      const { user } = await open("buy");
      await user.type(payField(), typed);
      expect(await screen.findByText(message)).toBeTruthy();
      expect(reviewButton().disabled).toBe(true);
    });

    it("offers whole-rupee presets inside the limits", async () => {
      member();
      const { user } = await open("buy");
      const presets = screen.getAllByRole("button", { name: /^රු\. / });
      expect(presets.map((preset) => preset.textContent)).toEqual([
        "රු. 1,000",
        "රු. 2,500",
        "රු. 5,000",
        "රු. 10,000",
      ]);

      await user.click(presets[1]);
      expect(value("You pay")).toBe("2,500.00");
    });

    it("offers a retry when the price can't be loaded", async () => {
      member();
      backend("GET", "/buy/price", failWith(502, "Price feed down"));
      const { user } = renderScreen(<TradeSheet open onOpenChange={vi.fn()} initialKind="buy" />);

      expect(await screen.findByText("Couldn't load the current price and fees")).toBeTruthy();

      backend("GET", "/buy/price", BUY_PRICE);
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByText("From රු. 500.00 · up to රු. 100,000.00 at a time")
      ).toBeTruthy();
    });
  });

  describe("identity verification", () => {
    it.each([
      ["NOT_STARTED", "Verify your identity.", "Verify"],
      ["IN_PROGRESS", "Finish verifying.", "Continue"],
      ["DECLINED", "Verify again.", "Verify"],
    ])("when it is %s, blocks buying and sends the member to verify", async (kyc, title, cta) => {
      member({ kyc });
      const { user, onOpenChange } = await open("buy");
      expect(screen.getByText(title)).toBeTruthy();

      await user.type(payField(), "5000");
      expect(reviewButton().disabled).toBe(true);

      await user.click(screen.getByRole("button", { name: cta }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification");
    });

    it("while it is in review, blocks buying with nothing to do but wait", async () => {
      member({ kyc: "IN_REVIEW" });
      const { user } = await open("buy");
      expect(screen.getByText("Verification in review.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();

      await user.type(payField(), "5000");
      expect(reviewButton().disabled).toBe(true);
    });

    it("shows no notice to a verified member", async () => {
      member();
      await open("buy");
      expect(screen.queryByText(/Verif/)).toBeNull();
    });
  });

  describe("review and pay", () => {
    it("shows the fee, the estimate and that it is an estimate", async () => {
      member();
      const { user } = await open("buy");
      await review(user);

      const dialog = screen.getByRole("dialog", { name: "Review purchase" });
      expect(within(dialog).getByText("≈ 16,000 sats")).toBeTruthy();
      expect(within(dialog).getByText("This is an estimate")).toBeTruthy();
      expect(within(dialog).getByText("Fees (4%)")).toBeTruthy();
      expect(within(dialog).getByText("රු. 200.00")).toBeTruthy();
      expect(within(dialog).getByText("රු. 30,000,000.00 / BTC")).toBeTruthy();
      expect(within(dialog).getByText(/Up to රු\. 250,000\.00 a day/)).toBeTruthy();
    });

    it("creates a checkout for the amount and hands the browser to PayHere by POST", async () => {
      member();
      const links = backend("POST", "/buy/payhere-link", {
        link: "https://sandbox.payhere.lk/pay/checkout?merchant_id=121&order_id=buy_1&hash=ABC",
        order_id: "buy_1",
      });
      const opened = payHere();
      const { user } = await open("buy");
      await review(user);

      await user.click(screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" }));

      await waitFor(() => expect(opened).toHaveLength(1));
      expect(links[0].body).toEqual({ amount_lkr: 5000 });
      // the signed fields travel in the form body, not in the address
      expect(opened[0]).toEqual({
        action: "https://sandbox.payhere.lk/pay/checkout",
        method: "post",
        fields: { merchant_id: "121", order_id: "buy_1", hash: "ABC" },
      });
    });

    it("can't be paid twice while PayHere is opening", async () => {
      member();
      const links = backend("POST", "/buy/payhere-link", {
        link: "https://sandbox.payhere.lk/pay/checkout?order_id=buy_1",
        order_id: "buy_1",
      });
      payHere();
      const { user } = await open("buy");
      await review(user);
      const pay = screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" });

      await user.click(pay);
      await waitFor(() => expect(links).toHaveLength(1));

      expect((pay as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    });

    it("says so when the checkout link can't be opened, and lets the member try again", async () => {
      member();
      backend("POST", "/buy/payhere-link", { link: "not a link", order_id: "buy_1" });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { user } = await open("buy");
      await review(user);

      await user.click(screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Couldn't open PayHere. Please try again."
      );
      expect(
        (screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" }) as HTMLButtonElement)
          .disabled
      ).toBe(false);
    });

    it("shows the backend's reason when it refuses the purchase", async () => {
      member();
      backend("POST", "/buy/payhere-link", failWith(400, "You've reached today's limit"));
      const { user } = await open("buy");
      await review(user);

      await user.click(screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" }));

      expect((await screen.findByRole("alert")).textContent).toBe("You've reached today's limit");
    });

    it("sends the member to verify when the backend says they aren't verified after all", async () => {
      member();
      backend("POST", "/buy/payhere-link", failWith(403, "KYC not approved"));
      const { user, onOpenChange } = await open("buy");
      await review(user);

      await user.click(screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" }));

      await waitFor(() => expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification"));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("on coming back from PayHere to a cached page, closes and shows that purchase", async () => {
      member();
      backend("POST", "/buy/payhere-link", {
        link: "https://sandbox.payhere.lk/pay/checkout?order_id=buy_1",
        order_id: "buy_1",
      });
      const opened = payHere();
      const { user, onOpenChange } = await open("buy");
      await review(user);
      await user.click(screen.getByRole("button", { name: "Pay රු. 5,000.00 with PayHere" }));
      await waitFor(() => expect(opened).toHaveLength(1));

      // Safari restores the page, sheet and all, from its back/forward cache
      act(() => {
        const event = new Event("pageshow");
        Object.defineProperty(event, "persisted", { value: true });
        window.dispatchEvent(event);
      });

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/dashboard/buy?buy_order=buy_1");
    });
  });
});

describe("Sell", () => {
  const sellField = () => screen.getByRole("textbox", { name: "You sell" });

  /** Types the amount and gets a quote for it */
  async function review(user: User, sats = "100000") {
    await user.type(sellField(), sats);
    await user.click(reviewButton());
    await screen.findByRole("dialog", { name: "Review sale" });
  }

  const holdButton = () =>
    screen.getByRole("button", { name: /Press and Hold to Sell/ }) as HTMLButtonElement;

  /** Presses and keeps holding (the button confirms after 0.9 s) */
  const hold = () => fireEvent.pointerDown(holdButton());

  describe("the amount", () => {
    it("shows the spendable balance and estimates the rupees after the fee and bank charge", async () => {
      member();
      const { user } = await open("sell");
      expect(screen.getByText(/You have/).textContent).toContain("150,000 sats movable");
      expect(
        screen.getByText("1 BTC ≈ රු. 30,000,000.00 · 1.5% fee + රු. 50.00 bank charge")
      ).toBeTruthy();

      await user.type(sellField(), "100000");

      // 30,000.00 less 450.00 (1.5%) and 50.00
      await waitFor(() => expect(value("You receive (estimate)")).toBe("29,500.00"));
      expect(reviewButton().disabled).toBe(false);
    });

    it("works back from the rupees the member wants to receive", async () => {
      member();
      const { user } = await open("sell");
      await user.type(screen.getByRole("textbox", { name: "You receive (estimate)" }), "29500");
      await waitFor(() => expect(value("You sell (estimate)")).toBe("100,000"));
    });

    it.each([
      ["999", "Minimum is 1,000 sats"],
      ["150001", "That's more than your balance"],
    ])("refuses %s sats", async (typed, message) => {
      member();
      const { user } = await open("sell");
      await user.type(sellField(), typed);
      expect(await screen.findByText(message)).toBeTruthy();
      expect(reviewButton().disabled).toBe(true);
    });

    it("says when savings pots are why an amount can't be sold", async () => {
      member({ balance: 30_000, pots: 20_000 });
      const { user } = await open("sell");
      await user.type(sellField(), "40000");
      expect(
        await screen.findByText("You can use 30,000 sats. 20,000 are in savings pots")
      ).toBeTruthy();
    });

    it("fills in a share of the spendable balance", async () => {
      member({ balance: 80_000 });
      const { user } = await open("sell");
      await user.click(screen.getByRole("button", { name: "25%" }));
      expect(value("You sell")).toBe("20,000");

      await user.click(screen.getByRole("button", { name: "All" }));
      expect(value("You sell")).toBe("80,000");
    });

    it("falls back to the wallet summary when the live balance isn't available", async () => {
      member({ balance: 60_000, me: failWith(403, "Log in again", "relogin_required") });
      await open("sell");
      expect((await screen.findByText(/You have/)).textContent).toContain("60,000 sats movable");
    });
  });

  describe("what selling needs first", () => {
    it("blocks an unverified member and sends them to verify", async () => {
      member({ kyc: "NOT_STARTED" });
      const { user, onOpenChange } = await open("sell");
      expect(screen.getByText("Verify your identity.")).toBeTruthy();
      // one thing at a time: the bank notice waits
      expect(screen.queryByText("Add a bank account.")).toBeNull();

      await user.type(sellField(), "100000");
      expect(reviewButton().disabled).toBe(true);

      await user.click(screen.getByRole("button", { name: "Verify" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification");
    });

    it("blocks a member without a bank account and opens the bank form", async () => {
      member({ accounts: [] });
      const { user, onOpenChange } = await open("sell");
      expect(await screen.findByText("Add a bank account.")).toBeTruthy();

      await user.type(sellField(), "100000");
      expect(reviewButton().disabled).toBe(true);

      await user.click(screen.getByRole("button", { name: "Add bank" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitFor(() => expect(sheets.openAddBank).toHaveBeenCalledTimes(1));
    });

    it("blocks while the bank account is in review, with nothing to do but wait", async () => {
      member({ accounts: [bank("PENDING_REVIEW")] });
      const { user } = await open("sell");
      expect(await screen.findByText("Bank account in review.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add bank" })).toBeNull();

      await user.type(sellField(), "100000");
      expect(reviewButton().disabled).toBe(true);
    });

    it("asks for another account after a rejected one", async () => {
      member({ accounts: [bank("REJECTED")] });
      await open("sell");
      expect(
        await screen.findByText("Your last one couldn't be verified. Add another to receive LKR.")
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add bank" })).toBeTruthy();
    });
  });

  describe("review", () => {
    it("asks for a quote and shows exactly what it says, with the bank it pays to", async () => {
      member();
      const quotes = backend("POST", "/sell/quote", quote());
      const { user } = await open("sell");
      await review(user);

      expect(quotes[0].body).toEqual({ sats: 100_000 });
      const dialog = screen.getByRole("dialog", { name: "Review sale" });
      expect(within(dialog).getByText("රු. 29,500.00")).toBeTruthy();
      expect(within(dialog).getByText("for 100,000 sats")).toBeTruthy();
      expect(within(dialog).getByText("රු. 30,000.00")).toBeTruthy();
      expect(within(dialog).getByText("Fee (1.5%)")).toBeTruthy();
      expect(within(dialog).getByText("− රු. 450.00")).toBeTruthy();
      expect(within(dialog).getByText("− රු. 50.00")).toBeTruthy();
      expect(within(dialog).getByText("Bank of Ceylon 00123456789")).toBeTruthy();
      expect(within(dialog).getByText(/Rate held for (1:00|0:59)/)).toBeTruthy();
    });

    it("shows the backend's reason when it can't quote", async () => {
      member();
      backend("POST", "/sell/quote", failWith(400, "Selling is paused right now"));
      const { user } = await open("sell");
      await user.type(sellField(), "100000");
      await user.click(reviewButton());

      expect((await screen.findByRole("alert")).textContent).toBe("Selling is paused right now");
      expect(screen.getByRole("dialog", { name: "Sell bitcoin" })).toBeTruthy();
    });

    it("can't be sold at a rate that has run out, until it is refreshed", async () => {
      member();
      const quotes = backend("POST", "/sell/quote", () => quote({ expiresAt: inSeconds(-5) }));
      const { user } = await open("sell");
      await review(user);

      expect(screen.getByText("Rate expired. Refresh to continue")).toBeTruthy();
      expect(holdButton().disabled).toBe(true);
      expect(screen.getByText("Refresh the rate to sell")).toBeTruthy();

      backend("POST", "/sell/quote", () =>
        quote({ id: "ord_2", amountLkr: 29_400, expiresAt: inSeconds(60) })
      );
      await user.click(screen.getByRole("button", { name: "Refresh" }));

      expect(await screen.findByText("රු. 29,400.00")).toBeTruthy();
      expect(holdButton().disabled).toBe(false);
      expect(quotes).toHaveLength(1);
    });
  });

  describe("confirming", () => {
    it("needs a hold: a tap sells nothing", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      const confirms = backend("POST", "/sell/orders/ord_1/confirm", sellOrder());
      const { user } = await open("sell");
      await review(user);

      await user.click(holdButton());

      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(confirms).toHaveLength(0);
      expect(screen.getByRole("dialog", { name: "Review sale" })).toBeTruthy();
    });

    it("confirms the quoted order after a hold, then follows the sale", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      const collecting = sellOrder({
        collect: { state: "pending", expiresAt: inSeconds(300), payInApp: true },
      });
      const confirms = backend("POST", "/sell/orders/ord_1/confirm", collecting);
      backend("GET", "/sell/orders/ord_1", collecting);
      const { user } = await open("sell");
      await review(user);

      hold();

      expect(
        await screen.findByRole("dialog", { name: "Selling" }, { timeout: 3000 })
      ).toBeTruthy();
      expect(confirms).toHaveLength(1);
      expect(confirms[0].body).toBeUndefined();
      // confirming moves no sats yet: the payment is approved next, with its own passkey
      expect(authenticate).not.toHaveBeenCalled();
      expect(screen.getByText("LKR sent to Bank of Ceylon 00123456789")).toBeTruthy();
    });

    it("can be confirmed from the keyboard, without a hold", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      const confirms = backend("POST", "/sell/orders/ord_1/confirm", sellOrder());
      backend("GET", "/sell/orders/ord_1", sellOrder());
      const { user } = await open("sell");
      await review(user);

      holdButton().focus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(confirms).toHaveLength(1));
    });

    it("says the quote expired when the backend says so, and asks for a refresh", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      backend("POST", "/sell/orders/ord_1/confirm", failWith(410, "Quote expired"));
      const { user } = await open("sell");
      await review(user);

      hold();

      expect(await screen.findByText("Quote expired", {}, { timeout: 3000 })).toBeTruthy();
      expect(await screen.findByText("Rate expired. Refresh to continue")).toBeTruthy();
      expect(holdButton().disabled).toBe(true);
    });

    it("shows the backend's reason when it refuses the sale", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      backend("POST", "/sell/orders/ord_1/confirm", failWith(400, "Your bank account was removed"));
      const { user } = await open("sell");
      await review(user);

      hold();

      expect(await screen.findByText("Sale failed", {}, { timeout: 3000 })).toBeTruthy();
      expect(screen.getByText("Your bank account was removed")).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "Review sale" })).toBeTruthy();
    });

    it("when no answer came, checks the order instead of assuming it failed", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      backend("POST", "/sell/orders/ord_1/confirm", failWith(504, "Gateway timeout"));
      // it did go through
      const orders = backend("GET", "/sell/orders/ord_1", sellOrder({ status: "PAYOUT_PENDING" }));
      const { user } = await open("sell");
      await review(user);

      hold();

      expect(await screen.findByText("Checking your sale", {}, { timeout: 3000 })).toBeTruthy();
      expect(await screen.findByRole("dialog", { name: "Selling" })).toBeTruthy();
      await waitFor(() => expect(orders.length).toBeGreaterThan(0));
      expect(screen.queryByText("Sale failed")).toBeNull();
    });

    it("offers the sale's page once it is under way", async () => {
      member();
      backend("POST", "/sell/quote", quote());
      const done = sellOrder({ status: "COMPLETED", completedAt: "2026-11-26T05:00:00Z" });
      backend("POST", "/sell/orders/ord_1/confirm", done);
      backend("GET", "/sell/orders/ord_1", done);
      const { user, onOpenChange } = await open("sell");
      await review(user);

      hold();

      expect(await screen.findByRole("dialog", { name: "Sold" }, { timeout: 3000 })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "View sale" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/sell/ord_1");
    });
  });
});
