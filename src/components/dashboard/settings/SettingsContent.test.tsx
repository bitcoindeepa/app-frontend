// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { userMe } from "@/test/fixtures";
import { setPlatform, telegramPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { getSessionSnapshot } from "@/lib/auth";
import { SettingsContent } from "@/components/dashboard/settings/SettingsContent";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const theme = vi.hoisted(() => ({ preference: "auto", setPreference: vi.fn() }));
const install = vi.hoisted(() => ({ kind: null as "prompt" | "ios" | null }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/context/theme", () => ({ useTheme: () => theme }));
vi.mock("@/pwa", () => ({
  useInstallKind: () => install.kind,
  InstallButton: () => <button type="button">Install the app</button>,
}));
// Sections with tests of their own
vi.mock("@/components/dashboard/settings/PasskeySection", () => ({ PasskeySection: () => null }));
vi.mock("@/components/dashboard/settings/PayoutAccountSection", () => ({
  PayoutAccountSection: () => null,
}));
vi.mock("@/components/dashboard/settings/PersonalDetailsSection", () => ({
  PersonalDetailsSection: () => null,
}));

startBackend();

/** Renders settings for a member with this profile and KYC status */
async function open({ profile = userMe(), kyc = "APPROVED", onNavigate = vi.fn() } = {}) {
  const me = backend("GET", "/user/me", profile);
  backend("GET", "/user/kyc/status", { status: kyc });
  backend("GET", "/subscription/current", failWith(404, "No subscription"));
  const view = renderScreen(<SettingsContent onNavigate={onNavigate} />);
  await waitFor(() => expect(me.length).toBeGreaterThan(0));
  await screen.findByText("Nimal Silva");
  return { ...view, onNavigate };
}

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard/profile");
  localStorage.clear();
  router.push.mockReset();
  router.replace.mockReset();
  theme.setPreference.mockReset();
  install.kind = null;
  await signInWeb();
});

afterEach(() => {
  // the balance-hidden choice is shared by every screen: leave it showing
  const hide = screen.queryByRole("switch", { name: "Hide balances" });
  if (hide?.getAttribute("aria-checked") === "true") act(() => hide.click());
});

describe("SettingsContent", () => {
  describe("the profile", () => {
    it("shows the member's name, our @username and that they are verified", async () => {
      await open();
      expect(screen.getByText("Nimal Silva")).toBeTruthy();
      expect(screen.getAllByText("@nimal").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
      expect(screen.getByText("Your identity is verified")).toBeTruthy();
    });

    it("offers an unverified member to verify, closing the sheet on the way", async () => {
      const { user, onNavigate } = await open({ kyc: "NOT_STARTED" });
      expect(await screen.findByText("Not verified")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Verify" }));

      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledExactlyOnceWith("/verification");
    });

    it.each([
      ["IN_PROGRESS", "Started. Finish it to buy and sell", "Continue"],
      ["DECLINED", "Declined. You can try again", "Verify"],
    ])("says where a %s verification stands", async (kyc, text, cta) => {
      await open({ kyc });
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.getByRole("button", { name: cta })).toBeTruthy();
    });

    it("has nothing to press while the verification is in review", async () => {
      await open({ kyc: "IN_REVIEW" });
      expect(await screen.findByText("In review")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^(Verify|Continue)$/ })).toBeNull();
    });

    it("offers to set up a username to a member without one", async () => {
      backend("GET", "/user/username/availability", { available: true, reason: null });
      const { user } = await open({ profile: userMe({ username: null }) });
      expect(screen.getByText("So others can send you sats")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Set up" }));
      expect(await screen.findByRole("dialog", { name: "Your username" })).toBeTruthy();
    });

    it("lets a member with a username copy it, not change it", async () => {
      await open();
      expect(screen.getByRole("button", { name: "Copy username" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
    });

    it("opens the picture picker", async () => {
      const { user } = await open();
      await user.click(screen.getByRole("button", { name: "Change profile picture" }));
      expect(await screen.findByRole("dialog", { name: "Profile picture" })).toBeTruthy();
    });
  });

  describe("preferences", () => {
    it("changes the appearance", async () => {
      const { user } = await open();
      await user.click(screen.getByRole("button", { name: "Dark" }));
      expect(theme.setPreference).toHaveBeenCalledExactlyOnceWith("dark");
    });

    it("hides balances everywhere, and remembers it", async () => {
      const { user } = await open();
      const hide = screen.getByRole("switch", { name: "Hide balances" });
      expect(hide.getAttribute("aria-checked")).toBe("false");

      await user.click(hide);

      expect(hide.getAttribute("aria-checked")).toBe("true");
      expect(localStorage.getItem("bitcoin-deepa-balance-hidden")).toBe("true");
    });

    it("offers to install the app only in a browser that can", async () => {
      await open();
      expect(screen.queryByRole("button", { name: "Install the app" })).toBeNull();
    });

    it("shows the install button where the browser supports it", async () => {
      install.kind = "prompt";
      await open();
      expect(screen.getByRole("button", { name: "Install the app" })).toBeTruthy();
    });
  });

  describe("logging out", () => {
    it("ends this session and goes to the sign-in page", async () => {
      const logouts = backend("POST", "/auth/logout");
      const { user, onNavigate } = await open();

      await user.click(screen.getByRole("button", { name: "Log out" }));

      await waitFor(() => expect(getSessionSnapshot().status).toBe("unauthenticated"));
      expect(logouts).toHaveLength(1);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/");
    });

    it("ends every session with “Log out of all devices”", async () => {
      const everywhere = backend("POST", "/auth/logout-all");
      const here = backend("POST", "/auth/logout");
      const { user } = await open();

      await user.click(screen.getByRole("button", { name: /Log out of all devices/ }));

      await waitFor(() => expect(getSessionSnapshot().status).toBe("unauthenticated"));
      expect(everywhere).toHaveLength(1);
      expect(here).toHaveLength(0);
    });

    it("says the member is still logged in when the backend doesn't confirm", async () => {
      backend("POST", "/auth/logout-all", failWith(500, "Something went wrong"));
      const { user } = await open();

      await user.click(screen.getByRole("button", { name: /Log out of all devices/ }));

      expect(await screen.findByText("Couldn't log out")).toBeTruthy();
      expect(
        screen.getByText("Check your connection and try again. You're still logged in.")
      ).toBeTruthy();
      expect(getSessionSnapshot().status).toBe("authenticated");
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("in the Mini App, offers only “Log out of all devices”, and no install", async () => {
      signOut();
      setPlatform(telegramPlatform());
      await signInMiniApp();
      install.kind = "prompt";
      const everywhere = backend("POST", "/auth/logout-all");
      const { user } = await open();

      expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Install the app" })).toBeNull();

      await user.click(screen.getByRole("button", { name: /Log out of all devices/ }));
      await waitFor(() => expect(everywhere).toHaveLength(1));
      expect(everywhere[0].headers.get("Authorization")).toBe("Bearer session-token");
    });
  });
});
