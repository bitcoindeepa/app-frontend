// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import type { PasskeyStatus } from "@/hooks/query/usePasskey";
import { setVisibility } from "@/test/dom";
import { telegramPlatform, webPlatform } from "@/test/platform";
import { renderHookWithClient } from "@/test/render";
import { backend, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import {
  getAppLockSnapshot,
  lockApp,
  passkeyRequired,
  readPasskeyHint,
  unlockApp,
  writePasskeyHint,
} from "@/lib/app-lock";
import { useAppLock } from "@/hooks/useAppLock";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

/** GET /passkey: a member with a passkey who is asked for it when the app opens */
const passkey = (over: Partial<PasskeyStatus> = {}): PasskeyStatus => ({
  enabled: true,
  unlocked: false,
  available: true,
  lock_on_open: true,
  passkeys: [
    { id: "pk_1", name: "iPhone", created_at: "2026-11-01T00:00:00Z", last_used_at: null },
  ],
  ...over,
});

/** Renders the hook and waits for GET /passkey to answer */
async function open(status: PasskeyStatus) {
  const requests = backend("GET", "/passkey", () => status);
  const view = renderHookWithClient(() => useAppLock());
  await waitFor(() => expect(view.queryClient.getQueryData(["passkey"])).toBeDefined());
  return { ...view, requests };
}

/** A launch: the app has just been opened, and starts locked */
function freshLaunch() {
  localStorage.clear();
  act(() => {
    unlockApp();
    lockApp();
  });
}

beforeEach(async () => {
  platform.current = webPlatform();
  freshLaunch();
  await signInWeb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAppLock", () => {
  describe("opening the app", () => {
    it("locks the dashboard for a member with a passkey", async () => {
      const { result } = await open(passkey());
      expect(result.current).toBe(true);
    });

    it("opens once the member unlocks with the passkey", async () => {
      const { result, queryClient } = await open(passkey());
      // what useUnlockWithPasskey does with the answer of POST /passkey/unlock
      act(() => {
        queryClient.setQueryData(["passkey"], passkey({ unlocked: true }));
        unlockApp();
      });
      expect(result.current).toBe(false);
    });

    it("stays locked while the backend says this session hasn't unlocked", async () => {
      const { result } = await open(passkey({ unlocked: false }));
      act(() => unlockApp());
      expect(result.current).toBe(true);
    });

    it("locks on every launch, even if the backend still counts the session as unlocked", async () => {
      const { result } = await open(passkey({ unlocked: true }));
      expect(result.current).toBe(true);
    });

    it("doesn't lock for a member without a passkey", async () => {
      const { result } = await open(
        passkey({ enabled: false, unlocked: true, lock_on_open: false, passkeys: [] })
      );
      expect(result.current).toBe(false);
    });

    it("doesn't lock where passkeys aren't available", async () => {
      const { result } = await open(passkey({ available: false }));
      expect(result.current).toBe(false);
    });

    it("doesn't lock while signed out", async () => {
      signOut();
      writePasskeyHint(true);
      const { result } = renderHookWithClient(() => useAppLock());
      expect(result.current).toBe(false);
    });
  });

  describe("before the backend has answered", () => {
    it("trusts this device's hint, so balances don't flash before the lock", () => {
      writePasskeyHint(true);
      backend("GET", "/passkey", () => new Promise<Response>(() => {}) as never);
      const { result } = renderHookWithClient(() => useAppLock());
      expect(result.current).toBe(true);
    });

    it("isn't locked without the hint", () => {
      backend("GET", "/passkey", () => new Promise<Response>(() => {}) as never);
      const { result } = renderHookWithClient(() => useAppLock());
      expect(result.current).toBe(false);
    });

    it("keeps the hint in step with the backend's answer", async () => {
      await open(passkey());
      expect(readPasskeyHint()).toBe(true);

      freshLaunch();
      writePasskeyHint(true);
      const { result } = await open(passkey({ lock_on_open: false }));
      expect(readPasskeyHint()).toBe(false);
      expect(result.current).toBe(false);
    });
  });

  describe("with “Ask when opening the app” off", () => {
    it("doesn't lock on launch, and drops the launch lock", async () => {
      const { result } = await open(passkey({ lock_on_open: false }));
      expect(result.current).toBe(false);
      expect(getAppLockSnapshot()).toBe(false);
    });

    it("doesn't lock after a minute in the background", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result } = await open(passkey({ lock_on_open: false }));
      setVisibility("hidden");
      vi.setSystemTime(Date.now() + 5 * 60_000);
      setVisibility("visible");
      expect(result.current).toBe(false);
    });

    it("still locks when the backend answers 403 passkey_required", async () => {
      const { result, requests } = await open(passkey({ lock_on_open: false }));
      expect(requests).toHaveLength(1);

      act(() => passkeyRequired());
      expect(result.current).toBe(true);
      // the cached status may be stale: ask again
      await waitFor(() => expect(requests).toHaveLength(2));

      act(() => unlockApp());
      expect(result.current).toBe(false);
    });
  });

  describe("in the background", () => {
    /** The app, open and unlocked */
    async function unlocked() {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const view = await open(passkey({ unlocked: true }));
      act(() => unlockApp());
      expect(view.result.current).toBe(false);
      return view;
    }

    it("locks again after 60 seconds away", async () => {
      const { result, requests } = await unlocked();
      setVisibility("hidden");
      vi.setSystemTime(Date.now() + 60_000);
      setVisibility("visible");
      expect(result.current).toBe(true);
      // and asks the backend again: the cached status may be stale
      await waitFor(() => expect(requests).toHaveLength(2));
    });

    it("stays open after less than 60 seconds away", async () => {
      const { result, requests } = await unlocked();
      setVisibility("hidden");
      vi.setSystemTime(Date.now() + 59_000);
      setVisibility("visible");
      expect(result.current).toBe(false);
      expect(requests).toHaveLength(1);
    });

    it("counts each time away on its own", async () => {
      const { result } = await unlocked();
      for (let i = 0; i < 3; i++) {
        setVisibility("hidden");
        vi.setSystemTime(Date.now() + 40_000);
        setVisibility("visible");
      }
      expect(result.current).toBe(false);
    });
  });

  describe("in the Mini App", () => {
    it("never locks: passkeys can't run in Telegram's webview", async () => {
      signOut();
      platform.current = telegramPlatform();
      await signInMiniApp();
      writePasskeyHint(true);
      const { result } = await open(passkey());
      expect(result.current).toBe(false);

      act(() => passkeyRequired());
      expect(result.current).toBe(false);
    });
  });
});
