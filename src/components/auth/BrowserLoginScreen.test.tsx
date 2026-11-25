// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { stubLocation } from "@/test/dom";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signOut } from "@/test/session";
import { getSessionSnapshot } from "@/lib/auth";
import { getAppLockSnapshot, lockApp, readPasskeyHint } from "@/lib/app-lock";
import BrowserLoginScreen from "@/components/auth/BrowserLoginScreen";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
}));
// The parts of the landing page that aren't about signing in
vi.mock("@/components/auth/UserProgress", () => ({ UserProgress: () => null }));
vi.mock("@/pwa", () => ({ InstallButton: () => null }));
vi.mock("@/components/auth/LandingShell", () => ({
  LandingShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  LogoStage: () => null,
}));

startBackend();

const supportsPasskeys = vi.mocked(browserSupportsWebAuthn);
const authenticate = vi.mocked(startAuthentication);
let assign: ReturnType<typeof vi.fn>;
const replaceState = vi.fn();

const ASSERTION = { id: "cred-1", type: "public-key" };

/** Opens the login page at `url` (path and query) */
function open(url = "/") {
  assign = stubLocation(url).assign;
  vi.spyOn(window.history, "replaceState").mockImplementation(replaceState);
  return renderScreen(<BrowserLoginScreen />);
}

function notAllowed() {
  const error = new Error("The operation either timed out or was not allowed.");
  error.name = "NotAllowedError";
  return error;
}

beforeEach(() => {
  setPlatform(webPlatform());
  signOut();
  sessionStorage.clear();
  localStorage.clear();
  replaceState.mockReset();
  supportsPasskeys.mockReset().mockReturnValue(true);
  authenticate.mockReset().mockResolvedValue(ASSERTION as never);
});

describe("BrowserLoginScreen", () => {
  describe("Sign in with Telegram", () => {
    it("leaves for the backend's login, to come back to the wallet", async () => {
      const { user } = open();
      await user.click(screen.getByRole("button", { name: "Sign in with Telegram" }));
      expect(assign).toHaveBeenCalledExactlyOnceWith(
        "https://api.test/auth/telegram/start?return_to=%2Fdashboard%3Ftab%3Dwallet"
      );
    });

    it("loads no Telegram script on the page", () => {
      open();
      expect(document.querySelector("script")).toBeNull();
      expect(document.querySelector("iframe")).toBeNull();
    });
  });

  describe("a login that failed", () => {
    it("explains the error the backend sent back, then drops it from the address", () => {
      open("/?login_error=cancelled&ref=FRIEND7");
      expect(screen.getByRole("alert").textContent).toBe(
        "Login was cancelled. Try again when you're ready."
      );
      // a reload doesn't show it again, and the rest of the address stays
      expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/?ref=FRIEND7");
    });

    it("never shows the code itself, whatever it says", () => {
      open("/?login_error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
      expect(screen.getByRole("alert").textContent).toBe(
        "Couldn't sign you in with Telegram. Please try again."
      );
      expect(document.querySelector("img[src='x']")).toBeNull();
    });

    it("shows no error on a normal visit", () => {
      open();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
    });
  });

  describe("Sign in with passkey", () => {
    it("is hidden where the browser can't do passkeys", () => {
      supportsPasskeys.mockReturnValue(false);
      open();
      expect(screen.queryByRole("button", { name: "Sign in with passkey" })).toBeNull();
      expect(screen.getByRole("button", { name: "Sign in with Telegram" })).toBeTruthy();
    });

    it("signs in, already unlocked, so the lock doesn't ask a second time", async () => {
      const options = backend("POST", "/auth/passkey/options", {
        attempt_id: "att_1",
        options: { challenge: "abc" },
      });
      const logins = backend("POST", "/auth/passkey/login");
      backend("GET", "/auth/me", { user: { telegram_id: "777", username: "nimal" } });
      act(() => lockApp());
      const { user } = open();

      await user.click(screen.getByRole("button", { name: "Sign in with passkey" }));

      await waitFor(() => expect(getSessionSnapshot().status).toBe("authenticated"));
      expect(options).toHaveLength(1);
      expect(authenticate).toHaveBeenCalledExactlyOnceWith({ optionsJSON: { challenge: "abc" } });
      expect(logins[0].body).toEqual({ attempt_id: "att_1", response: ASSERTION });
      expect(getAppLockSnapshot()).toBe(false);
      expect(readPasskeyHint()).toBe(true);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says nothing when the member closes the passkey prompt", async () => {
      backend("POST", "/auth/passkey/options", { attempt_id: "att_1", options: {} });
      const logins = backend("POST", "/auth/passkey/login");
      authenticate.mockRejectedValue(notAllowed());
      const { user } = open();

      await user.click(screen.getByRole("button", { name: "Sign in with passkey" }));

      await waitFor(() => expect(authenticate).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sign in with passkey" }).ariaBusy).toBeNull()
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(logins).toHaveLength(0);
      expect(getSessionSnapshot().status).toBe("unauthenticated");
    });

    it("shows why when the backend doesn't accept the passkey", async () => {
      backend("POST", "/auth/passkey/options", { attempt_id: "att_1", options: {} });
      backend("POST", "/auth/passkey/login", failWith(403, "This passkey isn't registered"));
      const { user } = open();

      await user.click(screen.getByRole("button", { name: "Sign in with passkey" }));

      expect((await screen.findByRole("alert")).textContent).toBe("This passkey isn't registered");
      expect(getSessionSnapshot().status).toBe("unauthenticated");
    });

    it("asks for a reload when the login worked but the account can't be loaded", async () => {
      backend("POST", "/auth/passkey/options", { attempt_id: "att_1", options: {} });
      backend("POST", "/auth/passkey/login");
      // e.g. the browser blocked the cookie
      backend("GET", "/auth/me", failWith(401, "Unauthorized"));
      const { user } = open();

      await user.click(screen.getByRole("button", { name: "Sign in with passkey" }));

      expect((await screen.findByRole("alert")).textContent).toBe(
        "You're signed in, but your account couldn't be loaded. Reload the page to continue."
      );
    });

    it("clears an earlier passkey error when trying again", async () => {
      backend("POST", "/auth/passkey/options", failWith(429, "Too many attempts"));
      const { user } = open();
      await user.click(screen.getByRole("button", { name: "Sign in with passkey" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Too many attempts");

      backend("POST", "/auth/passkey/options", { attempt_id: "att_1", options: {} });
      authenticate.mockRejectedValue(notAllowed());
      await user.click(screen.getByRole("button", { name: "Sign in with passkey" }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
  });

  describe("Prefer Telegram?", () => {
    it("links to the Mini App itself, in a tab that can't reach back into this page", () => {
      open();
      const link = screen.getByRole("link", { name: /Prefer Telegram/ }) as HTMLAnchorElement;
      expect(link.href).toBe("https://t.me/BitcoinDeepaBot/private_invite");
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    });
  });
});
