// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { noPasskey, passkeyStatus } from "@/test/fixtures";
import { telegramPlatform, setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { unlockApp } from "@/lib/app-lock";
import { PasskeySection } from "@/components/dashboard/settings/PasskeySection";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);
const register = vi.mocked(startRegistration);

const TWO = passkeyStatus({
  passkeys: [
    { id: "pk_1", name: "iPhone", created_at: "2026-11-01T04:00:00Z", last_used_at: null },
    {
      id: "pk_2",
      name: "Mac",
      created_at: "2026-10-01T04:00:00Z",
      last_used_at: "2026-11-20T04:00:00Z",
    },
  ],
});

function notAllowed() {
  const error = new Error("The operation either timed out or was not allowed.");
  error.name = "NotAllowedError";
  return error;
}

/** Renders the section once GET /passkey has answered with `status` */
async function open(status = passkeyStatus()) {
  backend("GET", "/passkey", status);
  const view = renderScreen(<PasskeySection />);
  await screen.findByText("App lock");
  return view;
}

const lockSwitch = () =>
  screen.getByRole("switch", { name: "Ask for your passkey when opening the app" });

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  localStorage.clear();
  act(() => unlockApp());
  authenticate.mockReset().mockResolvedValue({ id: "cred-1" } as never);
  register.mockReset().mockResolvedValue({ id: "cred-new" } as never);
  await signInWeb();
});

describe("PasskeySection", () => {
  it("shows nothing until the passkey status has loaded", () => {
    backend("GET", "/passkey", () => new Promise<Response>(() => {}) as never);
    renderScreen(<PasskeySection />);
    expect(screen.queryByText("App lock")).toBeNull();
  });

  describe("without a passkey", () => {
    it("offers to set one up, which turns the lock on", async () => {
      backend("POST", "/passkey/register/options", { challenge: "reg" });
      const registered = backend("POST", "/passkey/register", passkeyStatus());
      const { user } = await open(noPasskey());
      expect(screen.getByText("Lock with a passkey")).toBeTruthy();
      expect(screen.queryByRole("switch")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Set up" }));

      expect(await screen.findByText("Passkey lock on")).toBeTruthy();
      expect(screen.getByText("We'll ask for your passkey when you open the app.")).toBeTruthy();
      expect(registered).toHaveLength(1);
      // the new passkey is listed, with the setting on
      expect(await screen.findByText("iPhone")).toBeTruthy();
      expect(lockSwitch().getAttribute("aria-checked")).toBe("true");
    });

    it("says nothing when the member closes the passkey prompt", async () => {
      backend("POST", "/passkey/register/options", { challenge: "reg" });
      register.mockRejectedValue(notAllowed());
      const { user } = await open(noPasskey());

      await user.click(screen.getByRole("button", { name: "Set up" }));

      await waitFor(() => expect(register).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Set up" }).ariaBusy).toBeNull()
      );
      expect(screen.queryByText("Couldn't add the passkey")).toBeNull();
    });

    it("says why when the passkey can't be added", async () => {
      backend("POST", "/passkey/register/options", failWith(403, "Unlock with your passkey first"));
      const { user } = await open(noPasskey());

      await user.click(screen.getByRole("button", { name: "Set up" }));

      expect(await screen.findByText("Couldn't add the passkey")).toBeTruthy();
      expect(screen.getByText("Unlock with your passkey first")).toBeTruthy();
    });
  });

  describe("with passkeys", () => {
    it("lists them with when each was added or last used", async () => {
      await open(TWO);
      expect(screen.getByText("iPhone")).toBeTruthy();
      expect(screen.getByText("Added 1 Nov 2026")).toBeTruthy();
      expect(screen.getByText("Mac")).toBeTruthy();
      expect(screen.getByText("Last used 20 Nov 2026")).toBeTruthy();
    });

    it("adds another", async () => {
      backend("POST", "/passkey/register/options", { challenge: "reg" });
      backend("POST", "/passkey/register", TWO);
      const { user } = await open();

      await user.click(screen.getByRole("button", { name: "Add another passkey" }));

      expect(await screen.findByText("Passkey added")).toBeTruthy();
      expect(await screen.findByText("Mac")).toBeTruthy();
    });

    it("removes one after the member confirms", async () => {
      const platform = setPlatform(webPlatform());
      const removed = backend("DELETE", "/passkey/pk_2", passkeyStatus());
      const { user } = await open(TWO);

      await user.click(screen.getByRole("button", { name: "Remove Mac" }));

      expect(await screen.findByText("Passkey removed")).toBeTruthy();
      expect(platform.confirm).toHaveBeenCalledExactlyOnceWith({
        title: "Remove Mac?",
        message: "You won't be able to unlock with it anymore.",
        confirmText: "Remove",
        destructive: true,
      });
      expect(removed).toHaveLength(1);
      await waitFor(() => expect(screen.queryByText("Mac")).toBeNull());
    });

    it("warns that removing the only passkey turns the lock off", async () => {
      const platform = setPlatform(webPlatform());
      backend("DELETE", "/passkey/pk_1", noPasskey());
      const { user } = await open();

      await user.click(screen.getByRole("button", { name: "Remove iPhone" }));

      expect(await screen.findByText("Passkey lock off")).toBeTruthy();
      expect(platform.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "It's your only passkey, so the app will stop asking for one.",
        })
      );
      expect(await screen.findByText("Lock with a passkey")).toBeTruthy();
    });

    it("removes nothing when the member says no", async () => {
      setPlatform(webPlatform({ confirm: vi.fn(async () => false) }));
      const removed = backend("DELETE", "/passkey/pk_1", noPasskey());
      const { user } = await open();

      await user.click(screen.getByRole("button", { name: "Remove iPhone" }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(removed).toHaveLength(0);
      expect(screen.getByText("iPhone")).toBeTruthy();
    });

    it("says why when a passkey can't be removed", async () => {
      backend("DELETE", "/passkey/pk_1", failWith(403, "Unlock with your passkey first"));
      const { user } = await open();
      await user.click(screen.getByRole("button", { name: "Remove iPhone" }));
      expect(await screen.findByText("Couldn't remove it")).toBeTruthy();
      expect(screen.getByText("iPhone")).toBeTruthy();
    });
  });

  describe("“Ask when opening the app”", () => {
    it("shows the member's setting", async () => {
      await open(passkeyStatus({ lock_on_open: false }));
      expect(lockSwitch().getAttribute("aria-checked")).toBe("false");
    });

    it("turns off after the passkey, and says sending and selling still ask", async () => {
      backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
      backend("POST", "/passkey/unlock", passkeyStatus({ unlocked: true }));
      const settings = backend(
        "PATCH",
        "/passkey/settings",
        passkeyStatus({ lock_on_open: false })
      );
      const { user } = await open();

      await user.click(lockSwitch());

      expect(await screen.findByText("We won't ask when you open the app")).toBeTruthy();
      expect(screen.getByText("Sending and selling still need your passkey.")).toBeTruthy();
      expect(settings[0].body).toEqual({ lock_on_open: false });
      expect(lockSwitch().getAttribute("aria-checked")).toBe("false");
      // asked even though this session was already unlocked
      expect(authenticate).toHaveBeenCalledTimes(1);
    });

    it("asks for the passkey first when this session is locked", async () => {
      backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
      backend("POST", "/passkey/unlock", passkeyStatus({ unlocked: true }));
      backend("PATCH", "/passkey/settings", passkeyStatus({ lock_on_open: false }));
      const { user } = await open(passkeyStatus({ unlocked: false }));

      await user.click(lockSwitch());

      expect(await screen.findByText("We won't ask when you open the app")).toBeTruthy();
      expect(authenticate).toHaveBeenCalledTimes(1);
    });

    it("stays on when that passkey prompt is closed", async () => {
      backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
      const settings = backend(
        "PATCH",
        "/passkey/settings",
        passkeyStatus({ lock_on_open: false })
      );
      authenticate.mockRejectedValue(notAllowed());
      const { user } = await open(passkeyStatus({ unlocked: false }));

      await user.click(lockSwitch());

      await waitFor(() => expect(authenticate).toHaveBeenCalled());
      await waitFor(() => expect(lockSwitch().getAttribute("aria-checked")).toBe("true"));
      expect(settings).toHaveLength(0);
      expect(screen.queryByText("Couldn't change it")).toBeNull();
    });

    it("turns back on", async () => {
      const settings = backend("PATCH", "/passkey/settings", passkeyStatus({ lock_on_open: true }));
      const { user } = await open(passkeyStatus({ lock_on_open: false }));

      await user.click(lockSwitch());

      expect(await screen.findByText("We'll ask when you open the app")).toBeTruthy();
      expect(settings[0].body).toEqual({ lock_on_open: true });
    });
  });

  describe("in the Mini App", () => {
    beforeEach(async () => {
      signOut();
      setPlatform(telegramPlatform());
      await signInMiniApp();
    });

    it("can't set up a passkey: it points to Telegram's own passcode lock", async () => {
      await open(noPasskey({ available: false }));
      expect(screen.getByText(/Passkeys work in the browser app/)).toBeTruthy();
      expect(screen.getByText(/use Telegram's own passcode lock/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
      expect(screen.queryByRole("switch")).toBeNull();
    });

    it("tells a member who has one that it is on in the browser app", async () => {
      await open(passkeyStatus({ available: false }));
      expect(screen.getByText(/On in the browser app/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    });
  });
});
