// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { setVisibility } from "@/test/dom";
import { passkeyStatus } from "@/test/fixtures";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb } from "@/test/session";
import { getSessionSnapshot } from "@/lib/auth";
import { getAppLockSnapshot, lockApp } from "@/lib/app-lock";
import { PasskeyLock } from "@/components/passkey/PasskeyLock";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);
const ASSERTION = { id: "cred-1", type: "public-key" };

function notAllowed() {
  const error = new Error("The operation either timed out or was not allowed.");
  error.name = "NotAllowedError";
  return error;
}

/** A passkey prompt that stays open until the test answers it */
function promptStaysOpen() {
  let answer!: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
  authenticate.mockImplementationOnce(
    () => new Promise((resolve, reject) => (answer = { resolve, reject })) as never
  );
  return {
    approve: () => act(async () => answer.resolve(ASSERTION)),
    close: () => act(async () => answer.reject(notAllowed())),
  };
}

const lockedScreen = () => screen.findByRole("dialog", { name: "Bitcoin Deepa is locked" });

beforeEach(async () => {
  setPlatform(webPlatform());
  router.replace.mockReset();
  authenticate.mockReset().mockRejectedValue(notAllowed());
  await signInWeb();
  act(() => lockApp());
  backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
});

describe("PasskeyLock", () => {
  describe("as it appears", () => {
    it("opens the passkey prompt at once, with only the logo behind it", async () => {
      promptStaysOpen();
      renderScreen(<PasskeyLock />);

      expect(screen.getByRole("dialog", { name: "Unlocking Bitcoin Deepa" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Unlock with passkey" })).toBeNull();
      await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    });

    it("unlocks the session and the app when the member approves", async () => {
      const unlocks = backend("POST", "/passkey/unlock", passkeyStatus({ unlocked: true }));
      const prompt = promptStaysOpen();
      const { queryClient } = renderScreen(<PasskeyLock />);
      await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));

      await prompt.approve();

      await waitFor(() => expect(getAppLockSnapshot()).toBe(false));
      expect(unlocks[0].body).toEqual({ response: ASSERTION });
      expect(queryClient.getQueryData(["passkey"])).toEqual(passkeyStatus({ unlocked: true }));
    });

    it("shows the locked screen, with no error, when that first prompt is closed", async () => {
      renderScreen(<PasskeyLock />);
      expect(await lockedScreen()).toBeTruthy();
      expect(
        screen.getByText("Unlock with your passkey: Face ID, fingerprint or your device PIN.")
      ).toBeTruthy();
      expect(getAppLockSnapshot()).toBe(true);
    });

    it("shows why when the backend doesn't accept the passkey", async () => {
      authenticate.mockResolvedValue(ASSERTION as never);
      backend("POST", "/passkey/unlock", failWith(403, "Passkey not recognised"));
      renderScreen(<PasskeyLock />);
      await lockedScreen();
      expect(screen.getByText("Passkey not recognised")).toBeTruthy();
      expect(getAppLockSnapshot()).toBe(true);
    });
  });

  describe("the locked screen", () => {
    it("unlocks from the button", async () => {
      backend("POST", "/passkey/unlock", passkeyStatus({ unlocked: true }));
      const { user } = renderScreen(<PasskeyLock />);
      await lockedScreen();

      authenticate.mockResolvedValue(ASSERTION as never);
      await user.click(screen.getByRole("button", { name: "Unlock with passkey" }));

      await waitFor(() => expect(getAppLockSnapshot()).toBe(false));
    });

    it("says so when a prompt opened from the button is closed", async () => {
      const { user } = renderScreen(<PasskeyLock />);
      await lockedScreen();

      await user.click(screen.getByRole("button", { name: "Unlock with passkey" }));

      expect(await screen.findByText("Cancelled. Try again when you're ready.")).toBeTruthy();
    });

    it("asks again, behind the logo, each time the app comes back into focus", async () => {
      renderScreen(<PasskeyLock />);
      await lockedScreen();
      expect(authenticate).toHaveBeenCalledTimes(1);

      promptStaysOpen();
      setVisibility("hidden");
      expect(authenticate).toHaveBeenCalledTimes(1);

      setVisibility("visible");
      await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("dialog", { name: "Unlocking Bitcoin Deepa" })).toBeTruthy();
    });

    it("doesn't open a second prompt while one is already open", async () => {
      promptStaysOpen();
      renderScreen(<PasskeyLock />);
      await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
      setVisibility("hidden");
      setVisibility("visible");
      expect(authenticate).toHaveBeenCalledTimes(1);
    });

    it("has no way to reset the passkey in the app: it points to support", async () => {
      const platform = setPlatform(webPlatform());
      const { user } = renderScreen(<PasskeyLock />);
      await lockedScreen();

      await user.click(screen.getByRole("button", { name: "Can't use your passkey?" }));
      expect(screen.getByText(/Once we've checked it's you, we'll remove it/)).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Message support" }));
      expect(platform.openTelegramLink).toHaveBeenCalledExactlyOnceWith(
        "https://t.me/BitcoinDeepaBot"
      );
    });

    it("lets the member log out instead", async () => {
      const logouts = backend("POST", "/auth/logout");
      const { user } = renderScreen(<PasskeyLock />);
      await lockedScreen();

      await user.click(screen.getByRole("button", { name: "Log out" }));

      await waitFor(() => expect(getSessionSnapshot().status).toBe("unauthenticated"));
      expect(logouts).toHaveLength(1);
      expect(router.replace).toHaveBeenCalledWith("/");
    });

    it("says so, and stays signed in, when the logout can't be confirmed", async () => {
      backend("POST", "/auth/logout", failWith(500, "Something went wrong"));
      const { user } = renderScreen(<PasskeyLock />);
      await lockedScreen();

      await user.click(screen.getByRole("button", { name: "Log out" }));

      expect(await screen.findByText("Couldn't log out")).toBeTruthy();
      expect(getSessionSnapshot().status).toBe("authenticated");
    });
  });

  describe("covering the app", () => {
    it("makes everything behind it unusable, and gives it back afterwards", async () => {
      const behind = document.createElement("div");
      behind.innerHTML = `<button>Send sats</button>`;
      document.body.appendChild(behind);
      const sendButton = behind.querySelector("button") as HTMLButtonElement;
      sendButton.focus();

      const { unmount } = renderScreen(<PasskeyLock />);
      await lockedScreen();
      expect(behind.inert).toBe(true);
      expect(document.activeElement).not.toBe(sendButton);

      unmount();
      expect(behind.inert).toBe(false);
      expect(document.activeElement).toBe(sendButton);
      behind.remove();
    });

    it("leaves alone what was already inert", async () => {
      const already = document.createElement("div");
      already.inert = true;
      document.body.appendChild(already);

      const { unmount } = renderScreen(<PasskeyLock />);
      await lockedScreen();
      unmount();

      expect(already.inert).toBe(true);
      already.remove();
    });
  });
});
