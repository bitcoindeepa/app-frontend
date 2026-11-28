// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { userMe, walletSummary } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import type { DCSummary } from "@/lib/types";
import { WalletScreen } from "@/components/dashboard/wallet/WalletScreen";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const sheets = vi.hoisted(() => ({
  openTrade: vi.fn(),
  openSend: vi.fn(),
  openAddBank: vi.fn(),
  openCalculator: vi.fn(),
  openSettings: vi.fn(),
}));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/dashboard/sheets", () => ({ useSheets: () => sheets }));
// Drawn on a canvas, which jsdom doesn't have
vi.mock("@/components/dashboard/wallet/PortfolioChart", () => ({ PortfolioChart: () => null }));
// The rolling digits, as plain text
vi.mock("@/components/motion/number-ticker", () => ({
  NumberTicker: ({
    value,
    prefix = "",
    suffix = "",
    format,
  }: {
    value: number;
    prefix?: string;
    suffix?: string;
    format?: (value: number) => string;
  }) => <span>{`${prefix}${format ? format(Math.round(value)) : value}${suffix}`}</span>,
}));

startBackend();

const VERIFIED_BANK = {
  id: "acc_1",
  bankCode: 7010,
  bankName: "Bank of Ceylon",
  accountNumber: "•••• 6789",
  accountName: "Nimal Silva",
  status: "VERIFIED",
  rejectionReason: null,
  createdAt: "2026-11-01T04:00:00Z",
  reviewedAt: null,
};

/** A plan charge in GET /transaction/list */
const charge = (id: string, created_at: string, status = "SUCCESS") => ({
  type: "BUY",
  payhere_pay_id: id,
  created_at,
  satoshis_purchased: "3200",
  btc_price_at_purchase: "30000000",
  gross_amount: "1000",
  net_amount: "960",
  package_name: "Shrimp",
  kind: "RECURRING",
  status,
  settled: true,
});

/**
 * What the backend says about the member. By default: fully set up, with
 * 50,000 sats worth 15,000.00, up 1.2% today, and no plan.
 */
function member({
  summary = {} as Partial<DCSummary> | (() => Response),
  kyc = "APPROVED",
  accounts = [VERIFIED_BANK] as unknown[],
  username = "nimal" as string | null,
  plan = false,
  charges = [] as unknown[],
} = {}) {
  backend(
    "GET",
    "/transaction/dca-summary",
    (typeof summary === "function" ? summary : walletSummary(summary)) as never
  );
  backend("GET", "/transaction/list", { transactions: charges, has_more: false });
  backend("GET", "/user/kyc/status", { status: kyc });
  backend("GET", "/bank-accounts", accounts);
  backend("GET", "/user/me", userMe({ username }));
  backend("GET", "/user/username/availability", { available: true, reason: null });
  backend("GET", "/subscription/current", () =>
    plan
      ? Response.json({
          payhere_sub_id: "sub_1",
          package_id: "pkg_w1",
          package_name: "Shrimp Weekly",
          frequency: "weekly",
          dca_price: 1000,
          subscription_start_date: "2026-10-01T04:30:00Z",
          next_billing_date: "2026-12-03T04:30:00Z",
          created_at: "2026-10-01T04:30:00Z",
          updated_at: "2026-11-19T04:30:00Z",
          is_active: true,
        })
      : Response.json({ message: "No subscription" }, { status: 404 })
  );
}

/** Renders the wallet and waits for its numbers and the plan card */
async function open() {
  const view = renderScreen(<WalletScreen />);
  await screen.findByRole("button", { name: /^Balance/ });
  await screen.findByRole("button", { name: /No active DCA plan|Active/ });
  return view;
}

const balance = () => screen.getByRole("button", { name: /^Balance/ });
const hero = () => balance().parentElement as HTMLElement;
const step = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) }) as HTMLButtonElement;

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  localStorage.clear();
  router.push.mockReset();
  Object.values(sheets).forEach((spy) => spy.mockReset());
  await signInWeb();
});

afterEach(() => {
  // these choices are shared by every screen: leave them at their defaults
  const show = screen.queryByRole("button", { name: "Show balances" });
  if (show) act(() => show.click());
  const rupees = screen.queryByRole("button", { name: "Show values in rupees" });
  if (rupees) act(() => rupees.click());
});

describe("the wallet", () => {
  describe("the total", () => {
    it("shows the balance in sats, BTC and rupees, and today's change", async () => {
      member();
      await open();
      expect(balance().getAttribute("aria-label")).toBe("Balance 50,000 sats. Tap to switch units");
      expect(hero().textContent).toContain("50,000 sats");
      expect(hero().textContent).toContain("₿ 0.000500 BTC");
      expect(hero().textContent).toContain("≈ රු. 15,000.00");
      // 1.2% of 15,000.00
      expect(hero().textContent).toContain("රු. 180.00  (+1.20%) Last 24h");
    });

    it("swaps the big number between sats and rupees on a tap", async () => {
      member();
      const { user } = await open();

      await user.click(balance());

      expect(balance().getAttribute("aria-label")).toBe(
        "Balance රු. 15,000.00. Tap to switch units"
      );
      expect(balance().textContent).toContain("15,000.00");
    });

    it("shows dollars on request, at the backend's rate", async () => {
      member();
      const { user } = await open();

      await user.click(screen.getByRole("button", { name: "Show values in US dollars" }));

      // 15,000 LKR at 30M LKR and 100K USD per BTC
      expect(balance().getAttribute("aria-label")).toBe("Balance $50. Tap to switch units");
      expect(localStorage.getItem("bitcoin-deepa-display-currency")).toBe("USD");
    });

    it("can't switch to dollars while the dollar price is unknown", async () => {
      member({ summary: { current_btc_price: { lkr: 30_000_000 } as never } });
      await open();
      expect(
        (screen.getByRole("button", { name: "Show values in US dollars" }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    });

    it("says how much is locked in savings pots", async () => {
      member({
        summary: { total_balance: 50_000, spendable_balance: 30_000, pot_balance: 20_000 },
      });
      await open();
      // 20,000 of 50,000 sats, at the same rate as the 15,000.00 total
      expect(hero().textContent).toContain("20,000 sats in savings pots");
      expect(hero().textContent).toContain("≈ රු. 6,000.00");
    });

    it("says the balance is unavailable instead of showing a zero", async () => {
      member({ summary: { balance_available: false, total_balance: 0, total_lkr: "0" } });
      renderScreen(<WalletScreen />);
      expect(await screen.findByText("Balance unavailable")).toBeTruthy();
      expect(
        screen.getByText("Couldn't reach your wallet. Try again in a few minutes.")
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Balance/ })).toBeNull();
    });

    it("encourages a member with no sats yet, without a change figure", async () => {
      member({
        summary: { total_balance: 0, total_lkr: "0", spendable_balance: 0, "24_hr_change": 0 },
      });
      await open();
      expect(screen.getByText("Your first sats are one tap away")).toBeTruthy();
      expect(hero().textContent).not.toContain("Last 24h");
    });

    it("hides every amount when balances are hidden, and remembers it", async () => {
      member({ summary: { pot_balance: 20_000, spendable_balance: 30_000 } });
      const { user } = await open();

      await user.click(screen.getAllByRole("button", { name: "Hide balances" })[0]);

      expect(balance().textContent).toBe("**** sats");
      expect(hero().textContent?.replace("Last 24h", "")).not.toMatch(/\d/);
      // the wording around the numbers stays
      expect(hero().textContent).toContain("in savings pots");
      expect(hero().textContent).toContain("Last 24h");
      expect(localStorage.getItem("bitcoin-deepa-balance-hidden")).toBe("true");
    });

    it("opens the calculator", async () => {
      member();
      const { user } = await open();
      await user.click(screen.getByRole("button", { name: "Open calculator" }));
      expect(sheets.openCalculator).toHaveBeenCalledTimes(1);
    });
  });

  describe("quick actions", () => {
    it("open the buy, sell and send sheets", async () => {
      member();
      const { user } = await open();
      const actions = within(screen.getByRole("group", { name: "Quick actions" }));

      await user.click(actions.getByRole("button", { name: "Buy" }));
      await user.click(actions.getByRole("button", { name: "Sell" }));
      await user.click(actions.getByRole("button", { name: "Send" }));

      expect(sheets.openTrade.mock.calls).toEqual([["buy"], ["sell"]]);
      expect(sheets.openSend).toHaveBeenCalledTimes(1);
    });

    it("show Request as coming soon", async () => {
      member();
      await open();
      expect(
        (screen.getByRole("button", { name: "Request, coming soon" }) as HTMLButtonElement).disabled
      ).toBe(true);
    });
  });

  describe("getting started", () => {
    it("isn't shown to a member who has done everything", async () => {
      member();
      await open();
      await waitFor(() => expect(screen.getByText("My plan")).toBeTruthy());
      expect(screen.queryByText("Get started")).toBeNull();
    });

    it("lists what a new member still has to do, and takes them there", async () => {
      member({
        kyc: "NOT_STARTED",
        accounts: [],
        username: null,
        summary: { total_balance: 0, total_lkr: "0", spendable_balance: 0 },
      });
      const { user } = await open();

      expect(await screen.findByText("Four steps to get set up")).toBeTruthy();
      expect(screen.getByText("0 of 4 done")).toBeTruthy();

      await user.click(step("Verify your identity"));
      expect(router.push).toHaveBeenLastCalledWith("/verification");

      await user.click(step("Get your first sats"));
      expect(sheets.openTrade).toHaveBeenCalledExactlyOnceWith("buy");

      // the bank form needs a verified identity: that comes first
      await user.click(step("Add a bank account"));
      expect(sheets.openAddBank).not.toHaveBeenCalled();
      expect(router.push).toHaveBeenCalledTimes(2);

      await user.click(step("Set up your username"));
      expect(await screen.findByRole("dialog", { name: "Your username" })).toBeTruthy();
    });

    it("ticks off what is done, and opens the bank form for a verified member", async () => {
      member({ accounts: [], username: null });
      const { user } = await open();

      expect(await screen.findByText("Halfway there, 2 to go")).toBeTruthy();
      expect(step("Verify your identity").disabled).toBe(true);
      expect(step("Get your first sats").disabled).toBe(true);

      await user.click(step("Add a bank account"));
      expect(sheets.openAddBank).toHaveBeenCalledTimes(1);
    });

    it("counts a bank account that is still in review as added", async () => {
      member({ accounts: [{ ...VERIFIED_BANK, status: "PENDING_REVIEW" }], username: null });
      await open();
      expect(await screen.findByText("Almost there, 1 to go")).toBeTruthy();
      expect(step("Add a bank account").disabled).toBe(true);
    });
  });

  describe("the plan", () => {
    it("invites a member without one to start, and goes to Plans", async () => {
      member();
      const { user } = await open();
      const card = await screen.findByRole("button", { name: /No active DCA plan/ });

      await user.click(card);
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/plans");
    });

    it("shows the plan with its last and next reward", async () => {
      member({
        plan: true,
        charges: [
          charge("pay_1", "2026-11-12T04:30:00Z"),
          charge("pay_2", "2026-11-19T04:30:00Z"),
          // a failed charge isn't a reward
          charge("pay_3", "2026-11-25T04:30:00Z", "FAILED"),
        ],
      });
      await open();
      expect(await screen.findByRole("button", { name: /Shrimp/ })).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      expect(await screen.findByText("19 Nov 2026")).toBeTruthy();
      expect(screen.getByText("3 Dec 2026")).toBeTruthy();
    });
  });

  describe("performance", () => {
    it("compares what was paid, fees included, with what it is worth now", async () => {
      member();
      await open();
      const performance = screen.getByText("Performance").closest("section") as HTMLElement;
      // 12,000.00 bought 40,000 sats, plus 480.00 in fees
      expect(performance.textContent).toContain("රු. 12,000.00");
      expect(performance.textContent).toContain("+ රු. 480.00 fees");
      // 40,000 sats are worth 12,000.00 at 30M: down by the fees
      expect(performance.textContent).toContain("−රු. 480.00 (−4%)");
      expect(performance.textContent).toContain("රු. 29.0M per BTC");
      expect(performance.textContent).toContain("රු. 30.0M per BTC");
    });

    it("shows dashes, not zeros, before the first buy", async () => {
      member({ summary: { dca: { balance: 0, spent: 0, fees: 0, avg_btc_price: 0 } } });
      await open();
      const performance = screen.getByText("Performance").closest("section") as HTMLElement;
      expect(performance.textContent).toContain("No buys yet");
      expect(performance.textContent).not.toContain("රු. 0.00");
    });
  });

  it("says the balance is unavailable, not zero, when the wallet can't be loaded at all", async () => {
    member({ summary: failWith(502, "Wallet unreachable") });
    renderScreen(<WalletScreen />);
    expect(await screen.findByText("Balance unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Balance/ })).toBeNull();
    expect(screen.queryByText(/0\s*sats/)).toBeNull();
    expect(screen.queryByText("Your first sats are one tap away")).toBeNull();
  });
});
