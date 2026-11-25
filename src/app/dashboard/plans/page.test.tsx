// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { BTC_LKR, userMe, walletSummary } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import { ChoosePlanView } from "@/components/dashboard/plans/ChoosePlanView";
import PlansPage from "@/app/dashboard/plans/page";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));

startBackend();

const PACKAGES = [
  { id: "pkg_w1", name: "Shrimp Weekly", frequency: "weekly", amount: 1000, currency: "LKR" },
  {
    id: "pkg_w2",
    name: "Crab Weekly",
    frequency: "weekly",
    amount: 2500,
    currency: "LKR",
    popular: true,
  },
  { id: "pkg_m1", name: "Whale Monthly", frequency: "monthly", amount: 20_000, currency: "LKR" },
];

// 3% to the payment processor + 1% to Bitcoin Deepa, as for a one-time buy
const PRICE = {
  btcLkrPrice: BTC_LKR,
  paymentProcessorFeeBasisPoints: 300,
  bitcoindeepaFeeBasisPoints: 100,
  minLkr: 500,
  maxLkr: 100_000,
  dailyMaxLkr: 250_000,
};

/** The member's Shrimp plan, as GET /subscription/current sends it */
const SHRIMP = {
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
};

/** What the backend says about the member. `plan` can change during a test. */
function member({ kyc = "APPROVED", plan = null as typeof SHRIMP | null } = {}) {
  const state = { plan };
  backend("GET", "/user/kyc/status", { status: kyc });
  backend("GET", "/subscription/current", () =>
    state.plan
      ? Response.json(state.plan)
      : Response.json({ message: "No subscription" }, { status: 404 })
  );
  backend("GET", "/user/me", userMe());
  backend("GET", "/package", PACKAGES);
  backend("GET", "/buy/price", PRICE);
  // 40,000 sats bought for 12,000.00 plus 480.00 in fees; worth 12,000.00 today
  backend("GET", "/transaction/dca-summary", walletSummary());
  return state;
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

/** A plan's card in the list (its name comes first; the main button also names the plan) */
const planCard = (name: string) => ({ name: new RegExp(`^${name}`) });
const plan = (name: string) => screen.getByRole("button", planCard(name));
const cta = () =>
  screen.getByRole("button", {
    name: /^(Activate|Select a plan|Cancel .* to switch)/,
  }) as HTMLButtonElement;

function goOffline(offline: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(!offline);
  act(() => {
    window.dispatchEvent(new Event(offline ? "offline" : "online"));
  });
}

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard/plans");
  localStorage.clear();
  router.push.mockReset();
  await signInWeb();
});

afterEach(() => {
  // the balance-hidden choice is shared by every screen: leave it showing
  if (screen.queryByRole("button", { name: "Show balances" })) {
    act(() => screen.getByRole("button", { name: "Show balances" }).click());
  }
});

describe("the Plans tab", () => {
  it("asks an unverified member to verify first", async () => {
    member({ kyc: "NOT_STARTED" });
    const { user } = renderScreen(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Verification required" })).toBeTruthy();
    expect(screen.queryByText("Choose your plan")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Complete verification" }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification");
  });

  describe("without a plan: the plan picker", () => {
    it("lists the weekly plans with an estimate of the sats, and the monthly ones on request", async () => {
      member();
      const { user } = renderScreen(<PlansPage />);

      expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeTruthy();
      // 1,000 less 4% buys 3,200 sats at 30M
      expect(await screen.findByText("≈ 3,200 sats every week at today’s rate")).toBeTruthy();
      expect(plan("Shrimp").textContent).toContain("රු. 1,000.00");
      expect(plan("Shrimp").textContent).toContain("4% fee per payment");
      expect(plan("Crab")).toBeTruthy();
      expect(screen.queryByRole("button", planCard("Whale"))).toBeNull();

      await user.click(screen.getByRole("button", { name: "Monthly" }));
      expect(plan("Whale").textContent).toContain("රු. 20,000.00");
      expect(screen.queryByRole("button", planCard("Shrimp"))).toBeNull();
    });

    it("starts on the first plan and follows the member's choice", async () => {
      member();
      const { user } = renderScreen(<PlansPage />);
      await screen.findByText("≈ 3,200 sats every week at today’s rate");
      expect(cta().textContent).toBe("Activate Shrimp · රු. 1,000.00/week");

      await user.click(plan("Crab"));
      expect(plan("Crab").getAttribute("aria-pressed")).toBe("true");
      expect(cta().textContent).toBe("Activate Crab · රු. 2,500.00/week");
    });

    it("confirms the plan, then hands the browser to PayHere by POST", async () => {
      member();
      const links = backend("POST", "/subscription/payhere-link", {
        link: "https://sandbox.payhere.lk/pay/checkout?merchant_id=121&recurrence=1+Week&hash=ABC",
      });
      const opened = payHere();
      const { user } = renderScreen(<PlansPage />);
      await screen.findByText("≈ 3,200 sats every week at today’s rate");
      await user.click(plan("Crab"));

      await user.click(cta());
      const confirm = await screen.findByRole("dialog", { name: "Confirm plan" });
      expect(within(confirm).getByRole("heading", { name: "Crab" })).toBeTruthy();
      expect(within(confirm).getByText("Every week")).toBeTruthy();
      expect(within(confirm).getByText("4% of each payment")).toBeTruthy();
      expect(links).toHaveLength(0);

      await user.click(within(confirm).getByRole("button", { name: "Continue to PayHere" }));

      await waitFor(() => expect(opened).toHaveLength(1));
      expect(links[0].body).toEqual({ package_id: "pkg_w2" });
      expect(opened[0]).toEqual({
        action: "https://sandbox.payhere.lk/pay/checkout",
        method: "post",
        fields: { merchant_id: "121", recurrence: "1 Week", hash: "ABC" },
      });
    });

    it("sends the member to verify when the backend says they aren't verified after all", async () => {
      member();
      backend("POST", "/subscription/payhere-link", failWith(403, "KYC not approved"));
      const { user } = renderScreen(<PlansPage />);
      await screen.findByText("≈ 3,200 sats every week at today’s rate");

      await user.click(cta());
      await user.click(await screen.findByRole("button", { name: "Continue to PayHere" }));

      await waitFor(() => expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification"));
    });

    it.each([
      ["the backend fails", failWith(500, "Something went wrong")],
      ["the answer has no link", () => Response.json({})],
    ])("says the payment couldn't start when %s", async (_when, reply) => {
      member();
      backend("POST", "/subscription/payhere-link", reply);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { user } = renderScreen(<PlansPage />);
      await screen.findByText("≈ 3,200 sats every week at today’s rate");

      await user.click(cta());
      await user.click(await screen.findByRole("button", { name: "Continue to PayHere" }));

      expect(await screen.findByText("Couldn't Start Payment")).toBeTruthy();
      // and it can be tried again
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Continue to PayHere" }) as HTMLButtonElement)
            .disabled
        ).toBe(false)
      );
    });

    it("can't start a plan while offline", async () => {
      member();
      renderScreen(<PlansPage />);
      await screen.findByText("≈ 3,200 sats every week at today’s rate");
      expect(cta().disabled).toBe(false);

      goOffline(true);
      expect(cta().disabled).toBe(true);

      goOffline(false);
      expect(cta().disabled).toBe(false);
    });

    it("still lists the plans when the price for the estimate can't be loaded", async () => {
      member();
      backend("GET", "/buy/price", failWith(502, "Price feed down"));
      renderScreen(<PlansPage />);
      expect(await screen.findByRole("button", planCard("Shrimp"))).toBeTruthy();
      expect(plan("Shrimp").textContent).toContain("Fees apply per payment");
      expect(plan("Shrimp").textContent).not.toContain("≈");
    });
  });

  describe("with a plan", () => {
    it("shows the plan, what was invested with fees, and what it is worth now", async () => {
      member({ plan: SHRIMP });
      renderScreen(<PlansPage />);

      expect(await screen.findByText("Shrimp")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.getByText("රු. 1,000.00")).toBeTruthy();
      expect(await screen.findByText("40,000 sats · + රු. 480.00 fees")).toBeTruthy();
      // 12,000.00 invested and worth 12,000.00, less the 480.00 paid in fees
      expect(screen.getByText("−රු. 480.00 (4%)")).toBeTruthy();
      expect(screen.getByText("3 Dec 2026")).toBeTruthy();
      expect(screen.getByText("1 Oct 2026")).toBeTruthy();
    });

    it("hides the amounts, but not the dates, when balances are hidden", async () => {
      member({ plan: SHRIMP });
      const { user } = renderScreen(<PlansPage />);
      await screen.findByText("40,000 sats · + රු. 480.00 fees");

      await user.click(screen.getByRole("button", { name: "Hide balances" }));

      expect(screen.getByText("**** sats · + රු. **** fees")).toBeTruthy();
      expect(screen.getAllByText("රු. ****").length).toBeGreaterThan(0);
      expect(screen.queryByText("40,000 sats · + රු. 480.00 fees")).toBeNull();
      expect(screen.getByText("3 Dec 2026")).toBeTruthy();
      // remembered for the next launch
      expect(localStorage.getItem("bitcoin-deepa-balance-hidden")).toBe("true");
    });

    it("cancels the plan after the member confirms, then shows the picker", async () => {
      const platform = setPlatform(webPlatform());
      const state = member({ plan: SHRIMP });
      const cancels = backend("POST", "/subscription/cancel", () => {
        state.plan = null;
        return { message: "Cancelled" };
      });
      const { user } = renderScreen(<PlansPage />);

      await user.click(await screen.findByRole("button", { name: "Cancel plan" }));

      expect(await screen.findByText("Plan cancelled")).toBeTruthy();
      expect(platform.confirm).toHaveBeenCalledExactlyOnceWith({
        title: "Cancel plan?",
        message: "Shrimp stops right away and this can't be undone. Your sats stay in your wallet.",
        confirmText: "Cancel plan",
        cancelText: "Keep it",
        destructive: true,
      });
      expect(cancels).toHaveLength(1);
      expect(await screen.findByRole("heading", { name: "Choose your plan" })).toBeTruthy();
    });

    it("to change plan, cancels the current one first and says to pick the new one", async () => {
      const platform = setPlatform(webPlatform());
      const state = member({ plan: SHRIMP });
      backend("POST", "/subscription/cancel", () => {
        state.plan = null;
        return {};
      });
      const { user } = renderScreen(<PlansPage />);

      await user.click(await screen.findByRole("button", { name: "Change plan" }));

      expect(await screen.findByText("Now pick your new plan.")).toBeTruthy();
      expect(platform.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Cancel your plan first?", confirmText: "Cancel Shrimp" })
      );
    });

    it("cancels nothing when the member keeps the plan", async () => {
      setPlatform(webPlatform({ confirm: vi.fn(async () => false) }));
      member({ plan: SHRIMP });
      const cancels = backend("POST", "/subscription/cancel");
      const { user } = renderScreen(<PlansPage />);

      await user.click(await screen.findByRole("button", { name: "Cancel plan" }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(cancels).toHaveLength(0);
      expect(screen.getByText("Shrimp")).toBeTruthy();
    });

    it("says why when the plan can't be cancelled, and keeps showing it", async () => {
      member({ plan: SHRIMP });
      backend("POST", "/subscription/cancel", failWith(502, "PayHere didn't answer"));
      const { user } = renderScreen(<PlansPage />);

      await user.click(await screen.findByRole("button", { name: "Cancel plan" }));

      expect(await screen.findByText("Couldn't cancel the plan")).toBeTruthy();
      expect(screen.getByText("PayHere didn't answer")).toBeTruthy();
      expect(screen.getByText("Shrimp")).toBeTruthy();
    });

    it("can't change or cancel the plan while offline", async () => {
      member({ plan: SHRIMP });
      renderScreen(<PlansPage />);
      const cancel = (await screen.findByRole("button", {
        name: "Cancel plan",
      })) as HTMLButtonElement;

      goOffline(true);
      expect(cancel.disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Change plan" }) as HTMLButtonElement).disabled
      ).toBe(true);
      goOffline(false);
    });
  });
});

describe("the change-plan page", () => {
  it("shows the current plan and sells nothing until it is cancelled", async () => {
    member({ plan: SHRIMP });
    const links = backend("POST", "/subscription/payhere-link", { link: "https://x.test/pay" });
    const { user } = renderScreen(<ChoosePlanView />);

    expect(await screen.findByRole("heading", { name: "Change your plan" })).toBeTruthy();
    expect(await screen.findByText("You're on Shrimp.")).toBeTruthy();
    expect(cta().textContent).toBe("Cancel Shrimp to switch");
    expect(cta().disabled).toBe(true);

    // choosing another plan doesn't make it buyable either: one plan at a time
    await user.click(plan("Crab"));
    expect(cta().disabled).toBe(true);
    expect(links).toHaveLength(0);
  });

  it("opens on the frequency of the member's plan", async () => {
    member({
      plan: {
        ...SHRIMP,
        package_id: "pkg_m1",
        package_name: "Whale Monthly",
        frequency: "monthly",
      },
    });
    renderScreen(<ChoosePlanView />);
    expect(await screen.findByRole("button", planCard("Whale"))).toBeTruthy();
    expect(screen.queryByRole("button", planCard("Shrimp"))).toBeNull();
  });

  it("goes back to the plan, or to the wallet when there is none", async () => {
    member({ plan: SHRIMP });
    const withPlan = renderScreen(<ChoosePlanView />);
    await screen.findByText("You're on Shrimp.");
    await withPlan.user.click(screen.getByRole("button", { name: /back/i }));
    expect(router.push).toHaveBeenLastCalledWith("/dashboard/plans");
    withPlan.unmount();

    signOut();
    await signInWeb();
    member();
    const without = renderScreen(<ChoosePlanView />);
    await screen.findByRole("heading", { name: "Choose your plan" });
    await without.user.click(screen.getByRole("button", { name: /back/i }));
    expect(router.push).toHaveBeenLastCalledWith("/dashboard");
  });
});
