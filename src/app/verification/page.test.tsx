// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { userMe } from "@/test/fixtures";
import { setPlatform, telegramPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import VerificationIntroPage from "@/app/verification/page";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));

startBackend();

/** Opens the page for a member whose verification is in this state */
async function open(kyc: { status: string; url?: string } | null) {
  backend("GET", "/user/me", userMe());
  backend("GET", "/subscription/current", failWith(404, "No subscription"));
  const statuses = backend(
    "GET",
    "/user/kyc/status",
    kyc ? () => kyc : failWith(500, "Something went wrong")
  );
  const view = renderScreen(<VerificationIntroPage />);
  await waitFor(() => expect(statuses.length).toBeGreaterThan(0));
  return { ...view, statuses };
}

const onAPhone = () => setPlatform(webPlatform({ isMobileDevice: true }));

beforeEach(async () => {
  signOut();
  onAPhone();
  stubLocation("/verification");
  router.push.mockReset();
  await signInWeb();
});

describe("the verification page", () => {
  describe("before starting", () => {
    it("explains the steps and starts with the member's details", async () => {
      const { user } = await open({ status: "NOT_STARTED" });
      expect(await screen.findByRole("heading", { name: "Verify your identity" })).toBeTruthy();
      expect(screen.getByText("Your NIC, passport or driving licence")).toBeTruthy();
      expect(screen.getByText("A quick selfie")).toBeTruthy();
      expect(screen.getByText("Takes less than 2 minutes")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Start verification" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification/details");
    });

    it("on a computer, asks the member to use their phone instead of starting", async () => {
      setPlatform(webPlatform({ isMobileDevice: false }));
      const { user } = await open({ status: "NOT_STARTED" });

      await user.click(await screen.findByRole("button", { name: "Start verification" }));

      expect(await screen.findByRole("dialog", { name: "Use your phone" })).toBeTruthy();
      expect(
        screen.getByText("Identity verification needs a phone camera, for your security.")
      ).toBeTruthy();
      expect(router.push).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Got it" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Use your phone" })).toBeNull()
      );
    });

    it("counts Telegram on a phone as a phone", async () => {
      setPlatform({ ...telegramPlatform(), isMobileDevice: true });
      const { user } = await open({ status: "NOT_STARTED" });
      await user.click(await screen.findByRole("button", { name: "Start verification" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification/details");
    });

    it("shows the plain introduction when the status can't be read", async () => {
      await open(null);
      expect(screen.getByRole("heading", { name: "Verify your identity" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Start verification" })).toBeTruthy();
    });
  });

  describe("part way through", () => {
    it("continues on the provider's page", async () => {
      const platform = onAPhone();
      const { user } = await open({
        status: "IN_PROGRESS",
        url: "https://verify.example/session/abc",
      });

      await user.click(await screen.findByRole("button", { name: "Continue verification" }));

      expect(platform.openLink).toHaveBeenCalledExactlyOnceWith(
        "https://verify.example/session/abc"
      );
    });

    it("on a computer, asks for the phone instead of opening the provider", async () => {
      const platform = setPlatform(webPlatform({ isMobileDevice: false }));
      const { user } = await open({
        status: "IN_PROGRESS",
        url: "https://verify.example/session/abc",
      });

      await user.click(await screen.findByRole("button", { name: "Continue verification" }));

      expect(await screen.findByRole("dialog", { name: "Use your phone" })).toBeTruthy();
      expect(platform.openLink).not.toHaveBeenCalled();
    });

    it("checks the status again when there is no link to continue with", async () => {
      const { user, statuses } = await open({ status: "IN_PROGRESS" });
      const before = statuses.length;

      await user.click(await screen.findByRole("button", { name: "Check verification status" }));

      await waitFor(() => expect(statuses.length).toBeGreaterThan(before));
    });
  });

  describe("in review", () => {
    it("says the documents are being reviewed, with nothing to do but go back", async () => {
      const { user } = await open({ status: "IN_REVIEW" });
      expect(
        await screen.findByRole("heading", { name: "We're reviewing your documents" })
      ).toBeTruthy();
      expect(screen.getByText("In review")).toBeTruthy();
      // no steps, and no way to start a second verification
      expect(screen.queryByText("A quick selfie")).toBeNull();
      expect(screen.queryByRole("button", { name: /verification/i })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Back to home" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard");
    });
  });

  describe("after one that didn't go through", () => {
    it.each([
      ["DECLINED", "Verification declined"],
      ["EXPIRED", "Verification expired"],
      ["ABANDONED", "Verification not finished"],
      ["KYC_EXPIRED", "Your verification expired"],
    ])("when it is %s, says so and offers a new one", async (status, title) => {
      const { user } = await open({ status });
      expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
      expect(screen.getByText("A quick selfie")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Start new verification" }));
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification/details");
    });
  });

  describe("approved", () => {
    it("says the member is verified and takes them to plans", async () => {
      const { user } = await open({ status: "APPROVED" });
      expect(await screen.findByRole("heading", { name: "You're verified" })).toBeTruthy();
      expect(screen.queryByText("A quick selfie")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Continue to plans" }));
      expect(router.push).toHaveBeenCalledWith("/dashboard/plans");
    });

    it("goes to plans by itself after two seconds", async () => {
      await open({ status: "APPROVED" });
      await screen.findByRole("heading", { name: "You're verified" });
      expect(router.push).not.toHaveBeenCalled();
      await waitFor(() => expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard/plans"), {
        timeout: 3000,
      });
    });
  });

  it("goes back to the dashboard", async () => {
    const { user } = await open({ status: "NOT_STARTED" });
    await user.click(await screen.findByRole("button", { name: /back/i }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });
});
