// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { stubLocation } from "@/test/dom";
import { p2pMe, p2pTransfer, passkeyStatus, userMe, walletSummary } from "@/test/fixtures";
import { telegramPlatform, setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend, type Seen } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { getSessionSnapshot } from "@/lib/auth";
import type { P2pMe } from "@/lib/p2p";
import type { BotTransaction } from "@/lib/types";
import SendSheet from "@/components/dashboard/send/SendSheet";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const sheets = vi.hoisted(() => ({ openSettings: vi.fn() }));
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
const KASUN = { telegram_id: 4242, username: "kasun_77", name: "Kasun P." };

const sent = (over: Partial<BotTransaction>): BotTransaction => ({
  id: 1,
  time: "2026-11-20T08:00:00Z",
  direction: "outgoing",
  from_id: 777,
  to_id: 4242,
  type: "internal",
  amount: 1000,
  amount_lkr: "300.00",
  success: true,
  status: "success",
  counterparty_username: "kasun_77",
  ...over,
});

/** The member's wallet, as the backend reports it when the sheet opens */
function wallet({
  me = p2pMe(),
  history = [] as BotTransaction[],
  profile = userMe(),
}: {
  me?: P2pMe | (() => Response);
  history?: BotTransaction[];
  profile?: ReturnType<typeof userMe>;
} = {}) {
  backend("GET", "/p2p/me", me as never);
  backend("GET", "/transaction/dca-summary", walletSummary());
  backend("GET", "/transaction/bot-history", {
    success: true,
    count: history.length,
    limit: 50,
    offset: 0,
    transactions: history,
  });
  backend("GET", "/user/me", profile);
  backend("POST", "/p2p/resolve", (seen: Seen) =>
    (seen.body as { to: string }).to === "kasun_77"
      ? Response.json(KASUN)
      : Response.json({ message: "No member has that username" }, { status: 404 })
  );
}

/** On the web a send needs a passkey approval: the member has one, and approves */
function withPasskey() {
  backend("GET", "/passkey", passkeyStatus());
  return backend("POST", "/passkey/approve/options", { challenge: "abc" });
}

async function open() {
  const onOpenChange = vi.fn();
  const view = renderScreen(<SendSheet open onOpenChange={onOpenChange} />);
  await screen.findByRole("dialog", { name: "Send sats" });
  await screen.findByText(/sats movable/);
  return { ...view, onOpenChange };
}

type User = Awaited<ReturnType<typeof open>>["user"];

const toField = () => screen.getByRole("textbox", { name: "To" });
const amountField = () => screen.getByRole("textbox", { name: "You send" });
const reviewButton = () => screen.getByRole("button", { name: /^Review/ }) as HTMLButtonElement;

/** Fills in who and how much, and goes to the review step */
async function review(user: User, sats = "5000") {
  await user.type(toField(), "kasun_77");
  await screen.findByText("Kasun P.");
  await user.type(amountField(), sats);
  await user.click(reviewButton());
  await screen.findByRole("dialog", { name: "Review" });
}

const sendButton = (label = "Send 5,000 sats") => screen.getByRole("button", { name: label });

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  router.push.mockReset();
  sheets.openSettings.mockReset();
  authenticate.mockReset().mockResolvedValue({ id: "cred-1" } as never);
  await signInWeb();
});

describe("SendSheet", () => {
  describe("who to send to", () => {
    it("finds a member by their @username once typing pauses", async () => {
      wallet();
      const { user } = await open();
      expect(reviewButton().disabled).toBe(true);

      await user.type(toField(), "@Kasun_77");

      expect(await screen.findByText("Kasun P.")).toBeTruthy();
      expect(screen.getByText("@kasun_77")).toBeTruthy();
    });

    it("explains the username rules for something that can't be a username", async () => {
      wallet();
      const { user } = await open();
      await user.type(toField(), "k!");
      expect(
        await screen.findByText("Use 3-20 letters, digits or underscores, starting with a letter")
      ).toBeTruthy();
      expect(reviewButton().disabled).toBe(true);
    });

    it("says when no member has that username", async () => {
      wallet();
      const { user } = await open();
      await user.type(toField(), "nobody_here");
      expect(await screen.findByText("No member has that username")).toBeTruthy();
      expect(reviewButton().disabled).toBe(true);
    });

    it("offers the people the member sent to before, newest first, once each", async () => {
      wallet({
        history: [
          sent({
            id: 1,
            time: "2026-11-01T08:00:00Z",
            to_id: 4242,
            counterparty_username: "kasun_77",
          }),
          sent({
            id: 2,
            time: "2026-11-02T08:00:00Z",
            to_id: 5151,
            counterparty_username: "amara",
          }),
          sent({
            id: 3,
            time: "2026-11-03T08:00:00Z",
            to_id: 4242,
            counterparty_username: "kasun_77",
          }),
          // received, and a Lightning payment with no member: not people to send to
          sent({ id: 4, direction: "incoming", to_id: 777, counterparty_username: "sender" }),
          sent({ id: 0, type: "lightning", to_id: 0, counterparty_username: null }),
        ],
      });
      const { user } = await open();

      const recents = await screen.findAllByRole("button", { name: /^@/ });
      expect(recents.map((button) => button.textContent)).toEqual(["@kasun_77", "@amara"]);

      await user.click(recents[0]);
      expect(await screen.findByText("Kasun P.")).toBeTruthy();
    });
  });

  describe("how much", () => {
    it("shows the spendable balance and the limits", async () => {
      wallet();
      await open();
      expect(screen.getByText(/You have/).textContent).toContain("50,000 sats movable");
      expect(screen.getByText("Up to 100,000 sats per send · 500,000 more today")).toBeTruthy();
    });

    it("shows what the amount is worth in rupees", async () => {
      wallet();
      const { user } = await open();
      await user.type(amountField(), "5000");
      // 5,000 sats at 30M LKR per BTC
      await waitFor(() =>
        expect(
          (screen.getByRole("textbox", { name: "Worth (estimate)" }) as HTMLInputElement).value
        ).toBe("1,500.00")
      );
    });

    it.each([
      ["50001", "That's more than your balance"],
      ["0", null],
    ])("refuses %s sats", async (typed, message) => {
      wallet();
      const { user } = await open();
      await user.type(toField(), "kasun_77");
      await screen.findByText("Kasun P.");
      await user.type(amountField(), typed);
      if (message) expect(await screen.findByText(message)).toBeTruthy();
      expect(reviewButton().disabled).toBe(true);
    });

    it("names the limit it refuses with: per send, today, or savings pots", async () => {
      wallet({
        me: p2pMe({
          balance: 30_000,
          pot_balance: 20_000,
          limits: { ...p2pMe().limits, max_amount: 25_000, daily_remaining: 10_000 },
        }),
      });
      const { user } = await open();

      await user.type(amountField(), "26000");
      expect(await screen.findByText("Maximum per send is 25,000 sats")).toBeTruthy();

      await user.clear(amountField());
      await user.type(amountField(), "12000");
      expect(await screen.findByText("You can send 10,000 more sats today")).toBeTruthy();
    });

    it("fills in a preset, and Max is the most that can be sent right now", async () => {
      wallet({
        me: p2pMe({ balance: 7_500, limits: { ...p2pMe().limits, daily_remaining: 6_000 } }),
      });
      const { user } = await open();

      // over what can be sent: not offered
      expect(
        (screen.getByRole("button", { name: "10,000 sats" }) as HTMLButtonElement).disabled
      ).toBe(true);
      await user.click(screen.getByRole("button", { name: "5,000 sats" }));
      expect((amountField() as HTMLInputElement).value).toBe("5,000");

      await user.click(screen.getByRole("button", { name: "Max" }));
      expect((amountField() as HTMLInputElement).value).toBe("6,000");
    });

    // The balance is asked for three times, a second and two apart, before giving up
    it("can't continue when the balance couldn't be loaded", { timeout: 15_000 }, async () => {
      wallet({ me: failWith(502, "The wallet is unreachable") });
      const onOpenChange = vi.fn();
      const { user } = renderScreen(<SendSheet open onOpenChange={onOpenChange} />);

      expect(
        await screen.findByText("Your balance couldn't be loaded right now", {}, { timeout: 8_000 })
      ).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toBe("The wallet is unreachable");

      await user.type(toField(), "kasun_77");
      await screen.findByText("Kasun P.");
      await user.type(amountField(), "1000");
      expect(reviewButton().disabled).toBe(true);
    });
  });

  describe("review", () => {
    it("shows who, how much, its value and what's left today", async () => {
      wallet();
      const { user } = await open();
      await review(user);

      const dialog = screen.getByRole("dialog", { name: "Review" });
      expect(within(dialog).getByText("Kasun P. (@kasun_77)")).toBeTruthy();
      expect(within(dialog).getAllByText("5,000 sats").length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText("≈ රු. 1,500.00").length).toBeGreaterThan(0);
      expect(within(dialog).getByText("495,000 sats")).toBeTruthy();
      expect(within(dialog).getByText("This can't be undone.")).toBeTruthy();
    });

    it("says when the payment will need confirming in the bot chat", async () => {
      wallet();
      const { user } = await open();
      await review(user, "25000");
      expect(
        screen.getByText("You'll confirm this payment in the Bitcoin Deepa bot chat.")
      ).toBeTruthy();
    });

    it("doesn't say so for an amount inside the allowance", async () => {
      wallet();
      const { user } = await open();
      await review(user);
      expect(screen.queryByText(/confirm this payment in the Bitcoin Deepa bot chat/)).toBeNull();
    });

    it("goes back to change the amount", async () => {
      wallet();
      const { user } = await open();
      await review(user);

      await user.click(screen.getByRole("button", { name: "Back" }));

      await screen.findByRole("dialog", { name: "Send sats" });
      expect((amountField() as HTMLInputElement).value).toBe("5,000");
    });
  });

  describe("sending on the web", () => {
    it("asks for the passkey for exactly this send, then sends it and shows its progress", async () => {
      wallet();
      const approvals = withPasskey();
      const sends = backend("POST", "/p2p/send", p2pTransfer());
      backend("GET", "/p2p/transfers/tr_12345678abcd", p2pTransfer());
      const { user } = await open();
      await review(user);

      await user.click(sendButton());

      expect(await screen.findByText("Sending")).toBeTruthy();
      expect(sends).toHaveLength(1);
      const body = sends[0].body as Record<string, unknown>;
      expect(body).toEqual({
        to_telegram_id: 4242,
        amount: 5000,
        idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      // the passkey approval is bound to the same recipient, amount and payment
      expect(approvals[0].body).toEqual({ action: "p2p_send", ...body });
      expect(sends[0].headers.has("X-Passkey-Assertion")).toBe(true);
      expect(screen.getByText("Delivered to Kasun P. (@kasun_77)")).toBeTruthy();
    });

    it("sends the note along when there is one", async () => {
      wallet();
      withPasskey();
      const sends = backend("POST", "/p2p/send", p2pTransfer());
      backend("GET", "/p2p/transfers/tr_12345678abcd", p2pTransfer());
      const { user } = await open();
      await review(user);

      await user.type(screen.getByRole("textbox", { name: /Note/ }), "  lunch  ");
      await user.click(sendButton());

      await waitFor(() => expect(sends).toHaveLength(1));
      expect((sends[0].body as { memo?: string }).memo).toBe("lunch");
    });

    it("celebrates a send that completes, and offers the payment's page", async () => {
      wallet();
      withPasskey();
      const done = p2pTransfer({ status: "completed" });
      backend("POST", "/p2p/send", done);
      backend("GET", "/p2p/transfers/tr_12345678abcd", done);
      const { user, onOpenChange } = await open();
      await review(user);

      await user.click(sendButton());

      expect(await screen.findByRole("dialog", { name: "Sent" })).toBeTruthy();
      expect(screen.getByText("Sent to Kasun P. (@kasun_77)")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "View payment" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/send/tr_12345678abcd");
    });

    it("sends nothing when the member closes the passkey prompt, and can try again", async () => {
      wallet();
      withPasskey();
      const sends = backend("POST", "/p2p/send", p2pTransfer());
      backend("GET", "/p2p/transfers/tr_12345678abcd", p2pTransfer());
      const cancelled = new Error("Not allowed");
      cancelled.name = "NotAllowedError";
      authenticate.mockRejectedValueOnce(cancelled);
      const { user } = await open();
      await review(user);

      await user.click(sendButton());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Cancelled. Try again when you're ready."
      );
      expect(sends).toHaveLength(0);

      await user.click(sendButton());
      expect(await screen.findByText("Sending")).toBeTruthy();
      expect(sends).toHaveLength(1);
    });

    it("asks the member to log in again on relogin_required, without signing them out", async () => {
      wallet();
      withPasskey();
      backend("POST", "/p2p/send", failWith(403, "Log in again", "relogin_required"));
      const { user } = await open();
      await review(user);

      await user.click(sendButton());

      expect(await screen.findByRole("dialog", { name: "Log in to send" })).toBeTruthy();
      expect(getSessionSnapshot().status).toBe("authenticated");
    });

    it("shows the backend's reason when it refuses the send", async () => {
      wallet();
      withPasskey();
      backend("POST", "/p2p/send", failWith(400, "This member can't receive sats yet"));
      const { user } = await open();
      await review(user);

      await user.click(sendButton());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "This member can't receive sats yet"
      );
    });

    it("when the outcome is unknown, says so and retries the same payment, never a second one", async () => {
      wallet();
      withPasskey();
      let down = true;
      const sends = backend("POST", "/p2p/send", () =>
        down
          ? Response.json({ message: "Timed out", code: "outcome_unknown" }, { status: 504 })
          : Response.json(p2pTransfer())
      );
      backend("GET", "/p2p/transfers/tr_12345678abcd", p2pTransfer());
      const { user } = await open();
      await review(user);

      await user.click(sendButton());
      expect((await screen.findByRole("alert")).textContent).toBe(
        "We couldn't confirm this payment yet. Hold Send again to check: it won't send twice."
      );

      down = false;
      await user.click(sendButton());
      expect(await screen.findByText("Sending")).toBeTruthy();

      const keys = sends.map((send) => (send.body as { idempotency_key: string }).idempotency_key);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
    });

    it("uses a new payment key after the member goes back and reviews again", async () => {
      wallet();
      withPasskey();
      const sends = backend("POST", "/p2p/send", failWith(400, "Try a smaller amount"));
      const { user } = await open();
      await review(user);
      await user.click(sendButton());
      await screen.findByRole("alert");

      await user.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByRole("dialog", { name: "Send sats" });
      await user.clear(amountField());
      await user.type(amountField(), "4000");
      await user.click(reviewButton());
      await screen.findByRole("dialog", { name: "Review" });
      await user.click(sendButton("Send 4,000 sats"));
      await waitFor(() => expect(sends).toHaveLength(2));

      const keys = sends.map((send) => (send.body as { idempotency_key: string }).idempotency_key);
      expect(keys[1]).not.toBe(keys[0]);
    });
  });

  describe("sending in the Mini App", () => {
    beforeEach(async () => {
      signOut();
      setPlatform(telegramPlatform());
      await signInMiniApp();
    });

    it("sends with no passkey step", async () => {
      wallet();
      const sends = backend("POST", "/p2p/send", p2pTransfer());
      backend("GET", "/p2p/transfers/tr_12345678abcd", p2pTransfer());
      const { user } = await open();
      await review(user);

      await user.click(sendButton());

      expect(await screen.findByText("Sending")).toBeTruthy();
      expect(sends[0].headers.has("X-Passkey-Assertion")).toBe(false);
      expect(sends[0].headers.get("Authorization")).toBe("Bearer session-token");
      expect(authenticate).not.toHaveBeenCalled();
    });

    it("asks the member to reopen the app on relogin_required", async () => {
      wallet();
      backend("POST", "/p2p/send", failWith(403, "Log in again", "relogin_required"));
      const { user } = await open();
      await review(user);

      await user.click(sendButton());

      expect(await screen.findByRole("dialog", { name: "Reopen to send" })).toBeTruthy();
    });
  });

  describe("a member without a @username of their own", () => {
    it("is invited to claim one in settings", async () => {
      wallet({ profile: userMe({ username: null }) });
      const { user, onOpenChange } = await open();

      await user.click(await screen.findByRole("button", { name: /Claim your own @username/ }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      await waitFor(() => expect(sheets.openSettings).toHaveBeenCalledTimes(1));
    });

    it("isn't shown to a member who has one", async () => {
      wallet();
      await open();
      await screen.findByText(/sats movable/);
      expect(screen.queryByRole("button", { name: /Claim your own @username/ })).toBeNull();
    });
  });
});
