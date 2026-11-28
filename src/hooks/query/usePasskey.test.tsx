// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Platform } from "@/platform/types";
import { telegramPlatform, webPlatform } from "@/test/platform";
import { renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInWeb } from "@/test/session";
import { getAppLockSnapshot, lockApp, readPasskeyHint, unlockApp } from "@/lib/app-lock";
import { PasskeyStepError } from "@/lib/passkey";
import {
  useAddPasskey,
  usePasskeyApproval,
  usePasskeyStatus,
  useRemovePasskey,
  useSetLockOnOpen,
  useUnlockWithPasskey,
  type ApprovalAction,
  type PasskeyStatus,
} from "@/hooks/query/usePasskey";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
// The browser's passkey prompts
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);
const register = vi.mocked(startRegistration);

const passkey = (over: Partial<PasskeyStatus> = {}): PasskeyStatus => ({
  enabled: true,
  unlocked: true,
  available: true,
  lock_on_open: true,
  passkeys: [
    { id: "pk_1", name: "iPhone", created_at: "2026-11-01T00:00:00Z", last_used_at: null },
  ],
  ...over,
});
const noPasskey = passkey({ enabled: false, lock_on_open: false, passkeys: [] });

// What the browser hands back from each prompt (opaque to the app)
const ASSERTION = { id: "cred-1", type: "public-key", response: { signature: "c2ln" } };
const ATTESTATION = { id: "cred-new", type: "public-key", response: { attestationObject: "b2Jq" } };

const SEND: ApprovalAction = {
  action: "p2p_send",
  to_telegram_id: 4242,
  amount: 5000,
  idempotency_key: "key-1",
};

/** Reads the X-Passkey-Assertion header back, as the backend does */
function fromBase64Url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The PasskeyStepError a step fails with */
async function stepError(attempt: Promise<unknown>): Promise<PasskeyStepError> {
  const error = await attempt.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(PasskeyStepError);
  return error as PasskeyStepError;
}

function notAllowed() {
  const error = new Error("The operation either timed out or was not allowed.");
  error.name = "NotAllowedError";
  return error;
}

beforeEach(async () => {
  platform.current = webPlatform();
  localStorage.clear();
  act(() => unlockApp());
  authenticate.mockReset().mockResolvedValue(ASSERTION as never);
  register.mockReset().mockResolvedValue(ATTESTATION as never);
  await signInWeb();
});

describe("usePasskeyStatus", () => {
  it("reads GET /passkey for a signed-in member", async () => {
    const requests = backend("GET", "/passkey", passkey());
    const { result } = renderHookWithClient(() => usePasskeyStatus());
    await waitFor(() => expect(result.current.data).toEqual(passkey()));
    expect(requests).toHaveLength(1);
  });
});

describe("usePasskeyApproval", () => {
  const approve = (action: ApprovalAction = SEND) =>
    renderHookWithClient(() => usePasskeyApproval()).result.current(action);

  describe("on the web, with a passkey", () => {
    it("has the member approve exactly this action and returns it as a header", async () => {
      backend("GET", "/passkey", passkey());
      const options = backend("POST", "/passkey/approve/options", { challenge: "abc" });

      const headers = await approve();

      expect(options).toHaveLength(1);
      expect(options[0].body).toEqual(SEND);
      expect(authenticate).toHaveBeenCalledExactlyOnceWith({ optionsJSON: { challenge: "abc" } });
      expect(Object.keys(headers)).toEqual(["X-Passkey-Assertion"]);
      expect(fromBase64Url(headers["X-Passkey-Assertion"])).toEqual(ASSERTION);
    });

    it("sends the header as base64url, safe to put in a request", async () => {
      backend("GET", "/passkey", passkey());
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      // An answer whose plain base64 has "+", "/" or "=", and a letter outside ASCII
      const answer = { ...ASSERTION, id: "??>>ü" };
      expect(Buffer.from(JSON.stringify(answer)).toString("base64")).toMatch(/[+/=]/);
      authenticate.mockResolvedValue(answer as never);
      const headers = await approve();
      expect(headers["X-Passkey-Assertion"]).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(fromBase64Url(headers["X-Passkey-Assertion"])).toEqual(answer);
    });

    it("binds a sale payment to its order", async () => {
      backend("GET", "/passkey", passkey());
      const options = backend("POST", "/passkey/approve/options", { challenge: "abc" });
      await approve({ action: "sell_pay", order_id: "ord_1" });
      expect(options[0].body).toEqual({ action: "sell_pay", order_id: "ord_1" });
    });

    it("asks every time: one approval is never reused for the next action", async () => {
      backend("GET", "/passkey", passkey());
      const options = backend("POST", "/passkey/approve/options", { challenge: "abc" });
      const { result } = renderHookWithClient(() => usePasskeyApproval());
      await result.current(SEND);
      await result.current({ ...SEND, idempotency_key: "key-2" });
      expect(options).toHaveLength(2);
      expect(authenticate).toHaveBeenCalledTimes(2);
    });

    it("fails quietly when the member closes the prompt", async () => {
      backend("GET", "/passkey", passkey());
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      authenticate.mockRejectedValue(notAllowed());
      const error = await stepError(approve());
      expect(error.cancelled).toBe(true);
      expect(error.message).toBe("Cancelled. Try again when you're ready.");
    });

    it("fails with the backend's message when it refuses the approval", async () => {
      backend("GET", "/passkey", passkey());
      backend("POST", "/passkey/approve/options", failWith(403, "Amount is over your limit"));
      const error = await stepError(approve());
      expect(error.cancelled).toBe(false);
      expect(error.message).toBe("Amount is over your limit");
      expect(authenticate).not.toHaveBeenCalled();
    });

    it("fails when the passkey status can't be read", async () => {
      backend("GET", "/passkey", failWith(500, "Something went wrong"));
      const error = await stepError(approve());
      expect(error.message).toBe("Something went wrong");
      expect(authenticate).not.toHaveBeenCalled();
    });
  });

  describe("on the web, without a passkey yet", () => {
    it("offers to set one up, registers it, then asks for the approval", async () => {
      backend("GET", "/passkey", noPasskey);
      const registerOptions = backend("POST", "/passkey/register/options", { challenge: "reg" });
      const registered = backend("POST", "/passkey/register", passkey());
      const approveOptions = backend("POST", "/passkey/approve/options", { challenge: "abc" });
      act(() => lockApp());

      const { result, queryClient } = renderHookWithClient(() => usePasskeyApproval());
      const headers = await result.current(SEND);

      expect(platform.current.confirm).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: "Set up a passkey", confirmText: "Set up passkey" })
      );
      expect(registerOptions).toHaveLength(1);
      expect(register).toHaveBeenCalledExactlyOnceWith({ optionsJSON: { challenge: "reg" } });
      expect(registered[0].body).toEqual({ response: ATTESTATION, name: "Passkey" });
      // the new passkey is known to the app at once, and the app isn't locked behind it
      expect(queryClient.getQueryData(["passkey"])).toEqual(passkey());
      expect(readPasskeyHint()).toBe(true);
      expect(getAppLockSnapshot()).toBe(false);
      // then the approval itself
      expect(approveOptions[0].body).toEqual(SEND);
      expect(fromBase64Url(headers["X-Passkey-Assertion"])).toEqual(ASSERTION);
    });

    it("stops when the member says not now", async () => {
      platform.current = webPlatform({ confirm: vi.fn(async () => false) });
      backend("GET", "/passkey", noPasskey);
      const error = await stepError(approve());
      expect(error.cancelled).toBe(true);
      expect(error.message).toBe("You need a passkey to continue.");
      expect(register).not.toHaveBeenCalled();
      expect(authenticate).not.toHaveBeenCalled();
    });

    it("stops when creating the passkey is cancelled", async () => {
      backend("GET", "/passkey", noPasskey);
      backend("POST", "/passkey/register/options", { challenge: "reg" });
      register.mockRejectedValue(notAllowed());
      const error = await stepError(approve());
      expect(error.cancelled).toBe(true);
      expect(authenticate).not.toHaveBeenCalled();
    });
  });

  describe("where passkeys don't apply", () => {
    it("adds nothing inside Telegram, and asks the backend nothing", async () => {
      platform.current = telegramPlatform();
      await expect(approve()).resolves.toEqual({});
      expect(authenticate).not.toHaveBeenCalled();
      expect(platform.current.confirm).not.toHaveBeenCalled();
    });

    it("adds nothing while the platform is still unknown", async () => {
      platform.current = { ...webPlatform(), kind: null };
      await expect(approve()).resolves.toEqual({});
    });

    it("adds nothing when the backend says passkeys aren't available for this session", async () => {
      backend("GET", "/passkey", passkey({ available: false, enabled: false }));
      await expect(approve()).resolves.toEqual({});
      expect(platform.current.confirm).not.toHaveBeenCalled();
      expect(authenticate).not.toHaveBeenCalled();
    });
  });
});

describe("passkey changes", () => {
  it("adds a passkey on this device", async () => {
    backend("POST", "/passkey/register/options", { challenge: "reg" });
    const registered = backend("POST", "/passkey/register", passkey());
    act(() => lockApp());
    const { result, queryClient } = renderHookWithClient(() => useAddPasskey());

    await act(() => result.current.mutateAsync(undefined));

    expect(registered[0].body).toEqual({ response: ATTESTATION, name: "Passkey" });
    expect(queryClient.getQueryData(["passkey"])).toEqual(passkey());
    expect(readPasskeyHint()).toBe(true);
    expect(getAppLockSnapshot()).toBe(false);
  });

  it("unlocks the session and the app with a passkey", async () => {
    const options = backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
    const unlocks = backend("POST", "/passkey/unlock", passkey({ unlocked: true }));
    act(() => lockApp());
    const { result, queryClient } = renderHookWithClient(() => useUnlockWithPasskey());

    await act(() => result.current.mutateAsync(undefined));

    expect(options).toHaveLength(1);
    expect(authenticate).toHaveBeenCalledExactlyOnceWith({ optionsJSON: { challenge: "unlock" } });
    expect(unlocks[0].body).toEqual({ response: ASSERTION });
    expect(queryClient.getQueryData<PasskeyStatus>(["passkey"])?.unlocked).toBe(true);
    expect(getAppLockSnapshot()).toBe(false);
  });

  it("stays locked when the prompt is closed", async () => {
    backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
    const unlocks = backend("POST", "/passkey/unlock", passkey());
    authenticate.mockRejectedValue(notAllowed());
    act(() => lockApp());
    const { result } = renderHookWithClient(() => useUnlockWithPasskey());

    await expect(act(() => result.current.mutateAsync(undefined))).rejects.toThrow();

    expect(unlocks).toHaveLength(0);
    expect(getAppLockSnapshot()).toBe(true);
  });

  it("stays locked when the backend doesn't accept the passkey", async () => {
    backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
    backend("POST", "/passkey/unlock", failWith(403, "Passkey not recognised"));
    act(() => lockApp());
    const { result } = renderHookWithClient(() => useUnlockWithPasskey());

    await expect(act(() => result.current.mutateAsync(undefined))).rejects.toThrow(
      "Passkey not recognised"
    );
    expect(getAppLockSnapshot()).toBe(true);
  });

  it("removes a passkey; with none left the device stops expecting a lock", async () => {
    const removed = backend("DELETE", "/passkey/pk_1", noPasskey);
    localStorage.setItem("bitcoin-deepa-passkey-on", "true");
    const { result, queryClient } = renderHookWithClient(() => useRemovePasskey());

    await act(() => result.current.mutateAsync("pk_1"));

    expect(removed).toHaveLength(1);
    expect(queryClient.getQueryData(["passkey"])).toEqual(noPasskey);
    expect(readPasskeyHint()).toBe(false);
  });
});

describe("useSetLockOnOpen", () => {
  it("turns the prompt on without asking for the passkey", async () => {
    const settings = backend("PATCH", "/passkey/settings", passkey({ lock_on_open: true }));
    const { result } = renderHookWithClient(() => useSetLockOnOpen());

    await act(() => result.current.mutateAsync(true));

    expect(settings[0].body).toEqual({ lock_on_open: true });
    expect(authenticate).not.toHaveBeenCalled();
    expect(readPasskeyHint()).toBe(true);
  });

  it("asks for the passkey to turn it off even when this session is already unlocked", async () => {
    // An unlocked session isn't enough: whoever has the open device would
    // otherwise remove the prompt without proving who they are
    const order: string[] = [];
    backend("GET", "/passkey", passkey({ unlocked: true }));
    backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
    backend("POST", "/passkey/unlock", () => {
      order.push("unlock");
      return passkey({ unlocked: true });
    });
    const settings = backend("PATCH", "/passkey/settings", () => {
      order.push("settings");
      return passkey({ unlocked: true, lock_on_open: false });
    });
    const { result } = renderHookWithClient(() => useSetLockOnOpen());

    await act(() => result.current.mutateAsync(false));

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["unlock", "settings"]);
    expect(settings[0].body).toEqual({ lock_on_open: false });
    expect(readPasskeyHint()).toBe(false);
  });

  it("asks for the passkey first to turn it off from a locked session", async () => {
    const order: string[] = [];
    backend("GET", "/passkey", passkey({ unlocked: false }));
    backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
    backend("POST", "/passkey/unlock", () => {
      order.push("unlock");
      return passkey({ unlocked: true });
    });
    backend("PATCH", "/passkey/settings", () => {
      order.push("settings");
      return passkey({ unlocked: true, lock_on_open: false });
    });
    const { result } = renderHookWithClient(() => useSetLockOnOpen());

    await act(() => result.current.mutateAsync(false));

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["unlock", "settings"]);
  });

  it("leaves the setting on when that passkey prompt is closed", async () => {
    backend("GET", "/passkey", passkey({ unlocked: false }));
    backend("POST", "/passkey/unlock/options", { challenge: "unlock" });
    const settings = backend("PATCH", "/passkey/settings", passkey({ lock_on_open: false }));
    authenticate.mockRejectedValue(notAllowed());
    const { result } = renderHookWithClient(() => useSetLockOnOpen());

    await expect(act(() => result.current.mutateAsync(false))).rejects.toThrow();
    expect(settings).toHaveLength(0);
  });
});
