// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { BTC_LKR, userMe } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import { ChoosePlanView } from "@/components/dashboard/plans/ChoosePlanView";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const payHere = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/hooks", () => ({ usePayHereRedirect: () => payHere }));

startBackend();

const SHRIMP = "00000000-0000-0000-0000-000000000001";
const CRAB = "00000000-0000-0000-0000-000000000002";

/** The member, the plans and the price the picker loads */
function member({ plan }: { plan?: string } = {}) {
  backend("GET", "/user/kyc/status", { status: "APPROVED" });
  backend("GET", "/user/me", userMe());
  backend("GET", "/buy/price", {
    btcLkrPrice: BTC_LKR,
    paymentProcessorFeeBasisPoints: 100,
    bitcoindeepaFeeBasisPoints: 100,
    minLkr: 100,
    maxLkr: 100_000,
    dailyMaxLkr: 250_000,
  });
  backend("GET", "/package", [
    { id: SHRIMP, name: "Shrimp Weekly", frequency: "weekly", amount: 1000, currency: "LKR" },
    { id: CRAB, name: "Crab Weekly", frequency: "weekly", amount: 2500, currency: "LKR" },
  ]);
  backend(
    "GET",
    "/subscription/current",
    plan
      ? {
          payhere_sub_id: "S1",
          package_id: plan,
          package_name: "Shrimp Weekly",
          frequency: "weekly",
          dca_price: 1000,
          subscription_start_date: "2026-11-23T00:00:00Z",
          next_billing_date: "2026-11-30T00:00:00Z",
          created_at: "2026-11-23T00:00:00Z",
          updated_at: "2026-11-23T00:00:00Z",
          is_active: true,
        }
      : failWith(404, "Subscription not found")
  );
}

const cta = () => screen.getByRole("button", { name: /^(Activate|Switch to|You're on|Select)/ });

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard/plans/choose");
  router.push.mockReset();
  payHere.mockClear();
  await signInWeb();
});

describe("ChoosePlanView", () => {
  it("without a plan, subscribes as before (no switch)", async () => {
    member();
    const links = backend("POST", "/subscription/payhere-link", { link: "https://payhere/1" });
    const { user } = renderScreen(<ChoosePlanView asTab />);

    await user.click(await screen.findByRole("button", { name: /Activate Shrimp/ }));
    const sheet = await screen.findByRole("dialog", { name: "Confirm plan" });
    await user.click(within(sheet).getByRole("button", { name: "Continue to PayHere" }));

    await waitFor(() => expect(payHere).toHaveBeenCalledWith("https://payhere/1"));
    expect(links[0].body).toEqual({ package_id: SHRIMP });
  });

  it("with a plan, shows the others and switches in one checkout, without cancelling first", async () => {
    member({ plan: SHRIMP });
    const cancels = backend("POST", "/subscription/cancel");
    const links = backend("POST", "/subscription/payhere-link", { link: "https://payhere/2" });
    const { user } = renderScreen(<ChoosePlanView />);

    // Crab is picked for them (not the current plan)
    expect(await screen.findByRole("button", { name: /Switch to Crab/ })).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Shrimp stops once that first payment goes through"
    );

    await user.click(cta());
    const sheet = await screen.findByRole("dialog", { name: "Confirm switch" });
    expect(within(sheet).getByText("Shrimp, once you've paid")).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Continue to PayHere" }));

    await waitFor(() => expect(payHere).toHaveBeenCalledWith("https://payhere/2"));
    expect(links[0].body).toEqual({ package_id: CRAB, switch: true });
    expect(cancels).toHaveLength(0);
  });

  it("can't buy the plan they're already on", async () => {
    member({ plan: SHRIMP });
    const { user } = renderScreen(<ChoosePlanView />);
    await screen.findByRole("button", { name: /Switch to Crab/ });

    await user.click(screen.getByRole("button", { name: /Shrimp/, pressed: false }));

    const button = cta() as HTMLButtonElement;
    expect(button.textContent).toContain("You're on Shrimp");
    expect(button.disabled).toBe(true);
  });

  it("a 409 (the plan changed meanwhile) closes the sheet and says so", async () => {
    member({ plan: SHRIMP });
    backend(
      "POST",
      "/subscription/payhere-link",
      failWith(409, "User already has an active subscription")
    );
    const { user } = renderScreen(<ChoosePlanView />);

    await user.click(await screen.findByRole("button", { name: /Switch to Crab/ }));
    const sheet = await screen.findByRole("dialog", { name: "Confirm switch" });
    await user.click(within(sheet).getByRole("button", { name: "Continue to PayHere" }));

    expect(await screen.findByText("Your plan changed")).toBeTruthy();
    expect(payHere).not.toHaveBeenCalled();
  });
});
