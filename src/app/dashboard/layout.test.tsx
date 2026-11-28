// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { passkeyStatus } from "@/test/fixtures";
import { pendingPlatform, setPlatform, telegramPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { miniAppLogin, signInMiniApp, signInWeb, signOut } from "@/test/session";
import { onUnauthorized } from "@/lib/auth";
import { lockApp, unlockApp } from "@/lib/app-lock";
import { useRegisterUser } from "@/hooks/useRegisterUser";
import DashboardLayout from "@/app/dashboard/layout";

const nav = vi.hoisted(() => ({
  pathname: "/dashboard",
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
}));
// The shell's own parts, reduced to markers: this file is about what the layout decides
vi.mock("@/components/bottomNavigation", () => ({ default: () => <nav aria-label="Tabs" /> }));
vi.mock("@/components/dashboard/AppHeader", () => ({ AppHeader: () => <header /> }));
vi.mock("@/components/dashboard/sheets", () => ({
  SheetsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/pull-to-refresh", () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/passkey/PasskeyLock", () => ({
  PasskeyLock: () => <div role="dialog" aria-label="Locked" />,
}));
vi.mock("@/app/dashboard/loading", () => ({ default: () => <p>wallet skeleton</p> }));
vi.mock("@/app/dashboard/plans/loading", () => ({ default: () => <p>plans skeleton</p> }));
vi.mock("@/app/dashboard/activity/loading", () => ({ default: () => <p>activity skeleton</p> }));

startBackend();

/** The app-wide launch sign-in runs beside the layout, as in the real app */
function Launch() {
  useRegisterUser();
  return null;
}

function open(pathname = "/dashboard") {
  nav.pathname = pathname;
  return renderScreen(
    <>
      <Launch />
      <DashboardLayout>
        <p>the page</p>
      </DashboardLayout>
    </>
  );
}

/** What every dashboard page warms up, and the passkey status the lock reads */
function memberData(
  passkey = passkeyStatus({ enabled: false, lock_on_open: false, passkeys: [] })
) {
  return {
    kyc: backend("GET", "/user/kyc/status", { status: "APPROVED" }),
    subscription: backend("GET", "/subscription/current", failWith(404, "No subscription")),
    accounts: backend("GET", "/bank-accounts", []),
    passkey: backend("GET", "/passkey", passkey),
  };
}

const page = () => screen.queryByText("the page");
const tabs = () => screen.queryByRole("navigation", { name: "Tabs" });

beforeEach(() => {
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  localStorage.clear();
  nav.router.replace.mockReset();
  act(() => unlockApp());
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

describe("the dashboard layout", () => {
  // First on purpose: the session is only "loading" until it's first resolved in this file
  it("shows the tab's skeleton, not an empty page, while the session is unknown", () => {
    setPlatform(pendingPlatform());
    open("/dashboard/plans");
    expect(screen.getByText("plans skeleton")).toBeTruthy();
    expect(page()).toBeNull();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("renders news for real even then: it doesn't depend on the session", () => {
    // still "loading": nothing above resolved the session
    setPlatform(pendingPlatform());
    open("/dashboard/news");
    expect(page()).not.toBeNull();
  });

  describe("on the web", () => {
    it("sends a signed-out visitor to the sign-in page", () => {
      signOut();
      open();
      expect(nav.router.replace).toHaveBeenCalledWith("/");
    });

    it("shows the page to a signed-in member, and warms up what the tabs need", async () => {
      await signInWeb();
      const data = memberData();
      open();

      expect(page()).not.toBeNull();
      expect(tabs()).not.toBeNull();
      await waitFor(() => {
        expect(data.kyc).toHaveLength(1);
        expect(data.subscription).toHaveLength(1);
        expect(data.accounts).toHaveLength(1);
      });
      expect(nav.router.replace).not.toHaveBeenCalled();
    });

    it("asks nothing of the backend for a visitor who isn't signed in", async () => {
      signOut();
      const data = memberData();
      open();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(data.kyc).toHaveLength(0);
      expect(data.accounts).toHaveLength(0);
    });
  });

  describe("the passkey lock", () => {
    it("covers the dashboard and makes it unusable while locked", async () => {
      await signInWeb();
      memberData(passkeyStatus({ unlocked: false }));
      act(() => lockApp());
      open();

      expect(await screen.findByRole("dialog", { name: "Locked" })).toBeTruthy();
      const shell = screen.getByText("the page").closest("[inert]");
      expect(shell).not.toBeNull();
      expect(shell?.getAttribute("aria-hidden")).toBe("true");
    });

    it("comes off once the member unlocks", async () => {
      await signInWeb();
      memberData(passkeyStatus({ unlocked: true }));
      act(() => lockApp());
      open();
      await screen.findByRole("dialog", { name: "Locked" });

      act(() => unlockApp());

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Locked" })).toBeNull());
      expect(screen.getByText("the page").closest("[inert]")).toBeNull();
    });

    it("isn't there for a member without a passkey", async () => {
      await signInWeb();
      const data = memberData();
      act(() => lockApp());
      open();
      await waitFor(() => expect(data.passkey).toHaveLength(1));
      expect(screen.queryByRole("dialog", { name: "Locked" })).toBeNull();
    });
  });

  describe("in the Mini App", () => {
    beforeEach(() => {
      signOut();
      setPlatform(telegramPlatform());
    });

    it("shows the page to a signed-in member", async () => {
      await signInMiniApp();
      memberData();
      open();
      expect(page()).not.toBeNull();
    });

    it("keeps the member's place with a skeleton while it signs in again", async () => {
      await signInMiniApp();
      memberData();
      backend("POST", "/auth/telegram/miniapp", () => new Promise<Response>(() => {}) as never);
      open("/dashboard/activity");
      expect(page()).not.toBeNull();

      act(() => onUnauthorized("session-token"));

      expect(screen.getByText("activity skeleton")).toBeTruthy();
      expect(page()).toBeNull();
      expect(nav.router.replace).not.toHaveBeenCalled();
    });

    it("asks the member to reopen the app when its launch data is too old", async () => {
      backend("POST", "/auth/telegram/miniapp", failWith(401, "initData is too old"));
      open();
      expect(await screen.findByText("Session expired")).toBeTruthy();
      expect(
        screen.getByText("Close Bitcoin Deepa and open it again from the bot to continue.")
      ).toBeTruthy();
      expect(page()).toBeNull();
      expect(nav.router.replace).not.toHaveBeenCalled();
    });

    it("shows the page once the launch sign-in lands", async () => {
      backend("POST", "/auth/telegram/miniapp", miniAppLogin());
      memberData();
      open();
      await waitFor(() => expect(page()).not.toBeNull());
    });
  });

  describe("the tab bar", () => {
    beforeEach(async () => {
      await signInWeb();
      memberData();
    });

    it.each([
      "/dashboard",
      "/dashboard/activity",
      "/dashboard/plans",
      "/dashboard/news/abc",
      "/dashboard/sell",
    ])("stays on %s", (pathname) => {
      open(pathname);
      expect(tabs()).not.toBeNull();
    });

    it.each([
      "/dashboard/buy",
      "/dashboard/send/tr_1",
      "/dashboard/sell/ord_1",
      "/dashboard/profile",
    ])("is hidden on the pushed page %s", (pathname) => {
      open(pathname);
      expect(tabs()).toBeNull();
    });
  });

  it("opens a news article at the top", async () => {
    await signInWeb();
    memberData();
    open("/dashboard/news/abc");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves the scroll position alone on other pages", async () => {
    await signInWeb();
    memberData();
    open("/dashboard/activity");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
