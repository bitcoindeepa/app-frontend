// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { sellOrder } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend, type Seen } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import type { BotTransaction } from "@/lib/types";
import ActivityPage from "@/app/dashboard/activity/page";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

/** A row of GET /transaction/list: a plan charge of 1,000.00 that bought 3,200 sats */
const purchase = (over: Record<string, unknown> = {}) => ({
  type: "BUY",
  payhere_pay_id: "pay_1",
  created_at: "2026-11-20T08:00:00Z",
  satoshis_purchased: "3200",
  btc_price_at_purchase: "30000000",
  package_amount: "1000",
  gross_amount: "1,000.00",
  net_amount: "960.00",
  package_name: "Shrimp",
  kind: "RECURRING",
  status: "SUCCESS",
  settled: true,
  ...over,
});

const transfer = (over: Partial<BotTransaction> = {}): BotTransaction => ({
  id: 42,
  time: "2026-11-21T08:00:00Z",
  direction: "outgoing",
  from_id: 777,
  to_id: 4242,
  from_user: "telegram_nimal",
  to_user: "telegram_kasun",
  type: "internal",
  amount: 5000,
  amount_lkr: "1,500.00",
  success: true,
  status: "success",
  counterparty_username: "kasun_77",
  ...over,
});

const botPage = (transactions: BotTransaction[], count = transactions.length) => ({
  success: true,
  count,
  limit: 50,
  offset: 0,
  transactions,
});

/** The member's history, as the two sources report it */
function history({
  list = [] as unknown[] | (() => Response),
  bot = [] as BotTransaction[] | (() => Response),
} = {}) {
  const lists = backend(
    "GET",
    "/transaction/list",
    (typeof list === "function" ? list : () => ({ transactions: list, has_more: false })) as never
  );
  const bots = backend(
    "GET",
    "/transaction/bot-history",
    (typeof bot === "function" ? bot : () => botPage(bot)) as never
  );
  return { lists, bots };
}

/** The activity rows on screen (each opens its details) */
const rows = () =>
  screen.getAllByRole("button").filter((b) => b.getAttribute("aria-haspopup") === "dialog");
const titles = () => rows().map((row) => row.textContent ?? "");
const chip = (name: string) => screen.getByRole("button", { name });

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard/activity");
  localStorage.clear();
  await signInWeb();
});

afterEach(() => {
  // the balance-hidden choice is shared by every screen: leave it showing
  const show = screen.queryByRole("button", { name: "Show balances" });
  if (show) act(() => show.click());
});

describe("the Activity page", () => {
  describe("the list", () => {
    it("merges purchases, sales and transfers, newest first, grouped by day", async () => {
      history({
        list: [
          purchase(),
          {
            type: "SELL",
            created_at: "2026-11-22T08:00:00Z",
            sell_order: sellOrder({ status: "COMPLETED", createdAt: "2026-11-22T08:00:00Z" }),
          },
        ],
        bot: [transfer()],
      });
      renderScreen(<ActivityPage />);

      await screen.findByText("Bitcoin Sale");
      expect(titles().map((t) => t.match(/Bitcoin Sale|Sent|Membership Reward/)?.[0])).toEqual([
        "Bitcoin Sale",
        "Sent",
        "Membership Reward",
      ]);
      expect(screen.getByText("22 November 2026")).toBeTruthy();
      expect(screen.getByText("21 November 2026")).toBeTruthy();
      expect(screen.getByText("20 November 2026")).toBeTruthy();
    });

    it("shows what moved, signed, and to whom by our @username only", async () => {
      history({ list: [purchase()], bot: [transfer()] });
      renderScreen(<ActivityPage />);

      const sent = await screen.findByRole("button", { name: /^Sent/ });
      expect(sent.textContent).toContain("To @kasun_77");
      expect(sent.textContent).toContain("−5,000 sats");
      expect(sent.textContent).toContain("≈ රු. 1,500.00");
      // never the Telegram username the bot also sends
      expect(sent.textContent).not.toContain("telegram_kasun");

      const reward = screen.getByRole("button", { name: /^Membership Reward/ });
      expect(reward.textContent).toContain("Shrimp Plan");
      expect(reward.textContent).toContain("+3,200 sats");
      expect(reward.textContent).toContain("≈ රු. 1,000.00");
    });

    it("lists a purchase and a sale once: not again as the bot transfer that settled it", async () => {
      history({
        list: [
          purchase(),
          {
            type: "SELL",
            created_at: "2026-11-22T08:00:00Z",
            sell_order: sellOrder({ status: "COMPLETED", createdAt: "2026-11-22T08:00:00Z" }),
          },
        ],
        bot: [
          transfer({ id: 1, direction: "incoming", amount: 3200, purchase_settlement: true }),
          transfer({
            id: 2,
            amount: 100_000,
            sale_payment: true,
            sale_order_id: "ord_1",
            memo: "💰 Collect by @w from @u. Memo: rent",
          }),
        ],
      });
      const { user } = renderScreen(<ActivityPage />);

      await screen.findByText("Bitcoin Sale");
      expect(rows()).toHaveLength(2);
      expect(screen.queryByRole("button", { name: /^Sent/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Received/ })).toBeNull();

      // the sale carries the memo of the transfer that paid it
      await user.click(screen.getByRole("button", { name: /^Bitcoin Sale/ }));
      const details = await screen.findByRole("dialog", { name: "Bitcoin Sale" });
      expect(within(details).getByText("rent")).toBeTruthy();
    });

    it("strikes through a purchase whose sats were never credited", async () => {
      history({ list: [purchase({ status: "FAILED", settled: false })] });
      renderScreen(<ActivityPage />);

      const row = await screen.findByRole("button", { name: /^Membership Reward/ });
      const amount = within(row).getByText("3,200 sats");
      expect(amount.className).toContain("line-through");
      // no "+": it can't pass for a reward
      expect(row.textContent).not.toContain("+3,200");
    });

    it("says Processing, not +0 sats, for a payment that isn't priced yet", async () => {
      history({ list: [purchase({ satoshis_purchased: null, settled: false, kind: "ONE_TIME" })] });
      renderScreen(<ActivityPage />);
      const row = await screen.findByRole("button", { name: /^Bitcoin Purchase/ });
      expect(row.textContent).toContain("Processing");
      expect(row.textContent).not.toContain("0 sats");
    });

    it("hides the amounts when balances are hidden", async () => {
      history({ bot: [transfer()] });
      const { user } = renderScreen(<ActivityPage />);
      const sent = await screen.findByRole("button", { name: /^Sent/ });

      await user.click(screen.getByRole("button", { name: "Hide balances" }));

      expect(sent.textContent).toContain("−**** sats");
      expect(sent.textContent).toContain("≈ රු. ****");
      expect(sent.textContent).not.toContain("5,000");
      // who and when stay readable
      expect(sent.textContent).toContain("@kasun_77");
    });
  });

  describe("a transaction's details", () => {
    it("shows the status, the fee and the price, and the id to copy", async () => {
      history({ list: [purchase()] });
      const { user } = renderScreen(<ActivityPage />);

      await user.click(await screen.findByRole("button", { name: /^Membership Reward/ }));

      const details = await screen.findByRole("dialog", { name: "Membership Reward" });
      expect(within(details).getByText("Settled")).toBeTruthy();
      expect(within(details).getByText("20 Nov 2026, 1:30 PM")).toBeTruthy();
      expect(within(details).getByText("0.00003200 BTC")).toBeTruthy();
      // 1,000.00 paid, 960.00 bought bitcoin
      expect(within(details).getByText("රු. 40.00")).toBeTruthy();
      expect(within(details).getByText("රු. 30.0M")).toBeTruthy();
      expect(within(details).getByText("pay_1")).toBeTruthy();
    });

    it("shows a transfer's note without the bot's wrapper around it", async () => {
      history({
        bot: [
          transfer({ memo: "💸 P2P Send from @telegram_nimal to @telegram_kasun. Memo: lunch" }),
        ],
      });
      const { user } = renderScreen(<ActivityPage />);

      await user.click(await screen.findByRole("button", { name: /^Sent/ }));

      const details = await screen.findByRole("dialog", { name: "Sent" });
      expect(within(details).getByText("lunch")).toBeTruthy();
      expect(details.textContent).not.toContain("telegram_");
    });
  });

  describe("filtering", () => {
    const mixed = () =>
      history({
        list: [
          purchase(),
          purchase({
            payhere_pay_id: "pay_2",
            kind: "ONE_TIME",
            created_at: "2026-11-19T08:00:00Z",
          }),
        ],
        bot: [transfer()],
      });

    it("shows plan charges under Subscriptions, and buys and transfers under Transactions", async () => {
      mixed();
      const { user } = renderScreen(<ActivityPage />);
      await screen.findByRole("button", { name: /^Sent/ });
      expect(rows()).toHaveLength(3);

      await user.click(chip("Subscriptions"));
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(screen.getByRole("button", { name: /^Membership Reward/ })).toBeTruthy();

      await user.click(chip("Transactions"));
      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(screen.getByRole("button", { name: /^Bitcoin Purchase/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Sent/ })).toBeTruthy();
    });

    it("searches by type, member or plan", async () => {
      mixed();
      const { user } = renderScreen(<ActivityPage />);
      await screen.findByRole("button", { name: /^Sent/ });
      const search = screen.getByRole("searchbox", { name: "Search activity" });

      await user.type(search, "kasun");
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(screen.getByRole("button", { name: /^Sent/ })).toBeTruthy();

      await user.clear(search);
      await user.type(search, "shrimp");
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(screen.getByRole("button", { name: /^Membership Reward/ })).toBeTruthy();
    });

    it("says there are no matches, and clears the filters", async () => {
      mixed();
      const { user } = renderScreen(<ActivityPage />);
      await screen.findByRole("button", { name: /^Sent/ });

      await user.type(screen.getByRole("searchbox", { name: "Search activity" }), "zzz");
      expect(await screen.findByText("No matches")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      await waitFor(() => expect(rows()).toHaveLength(3));
    });
  });

  describe("when there is nothing, or something fails", () => {
    it("welcomes a member with no activity yet", async () => {
      history();
      renderScreen(<ActivityPage />);
      expect(await screen.findByText("No activity yet")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    });

    it("treats a 404 from either source as no activity, not an error", async () => {
      history({ list: failWith(404, "No transactions"), bot: failWith(404, "No transactions") });
      renderScreen(<ActivityPage />);
      expect(await screen.findByText("No activity yet")).toBeTruthy();
    });

    it("shows what loaded and names what didn't, with a retry", { timeout: 20_000 }, async () => {
      history({ list: [purchase()], bot: failWith(502, "Bot unreachable") });
      const { user } = renderScreen(<ActivityPage />);

      // the purchases show after a few seconds, without waiting out the bot's retry
      expect(
        await screen.findByRole("button", { name: /^Membership Reward/ }, { timeout: 8_000 })
      ).toBeTruthy();
      const notice = await screen.findByRole("alert", {}, { timeout: 8_000 });
      expect(notice.textContent).toContain("Couldn't load transfers. Showing what loaded.");

      backend("GET", "/transaction/bot-history", botPage([transfer()]));
      await user.click(within(notice).getByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("button", { name: /^Sent/ })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it(
      "treats the bot's own { success: false } as a failure, not as no transfers",
      { timeout: 20_000 },
      async () => {
        history({
          list: [purchase()],
          bot: () =>
            Response.json({ success: false, message: "Bot API timed out", transactions: [] }),
        });
        renderScreen(<ActivityPage />);
        const notice = await screen.findByRole("alert", {}, { timeout: 12_000 });
        expect(notice.textContent).toContain("Couldn't load transfers");
      }
    );

    it("says activity couldn't be loaded when nothing came back", { timeout: 20_000 }, async () => {
      history({ list: failWith(500, "Down"), bot: failWith(500, "Down") });
      renderScreen(<ActivityPage />);
      expect(
        await screen.findByText("Couldn't load activity", {}, { timeout: 12_000 })
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    });
  });

  describe("long histories", () => {
    it("loads the next page on request", async () => {
      const lists = backend("GET", "/transaction/list", (seen: Seen) => {
        const page = new URLSearchParams(seen.query).get("page");
        return Response.json(
          page === "1"
            ? { transactions: [purchase()], has_more: true }
            : {
                transactions: [
                  purchase({ payhere_pay_id: "pay_0", created_at: "2026-10-20T08:00:00Z" }),
                ],
                has_more: false,
              }
        );
      });
      backend("GET", "/transaction/bot-history", botPage([]));
      const { user } = renderScreen(<ActivityPage />);
      await screen.findByRole("button", { name: /^Membership Reward/ });
      expect(rows()).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Load more" }));

      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(lists.map((request) => new URLSearchParams(request.query).get("page"))).toEqual([
        "1",
        "2",
      ]);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });
  });
});
