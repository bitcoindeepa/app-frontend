// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import { setVisibility } from "@/test/dom";
import { telegramPlatform, webPlatform } from "@/test/platform";
import { renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { useSession } from "@/hooks/useSession";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

startBackend();

beforeEach(() => {
  platform.current = webPlatform();
  router.replace.mockReset();
});

describe("useSession", () => {
  // First on purpose: the session is only "loading" until it's first resolved in this file
  it("on the web, asks the backend who is signed in once the platform is known", async () => {
    const me = backend("GET", "/auth/me", { user: { telegram_id: "777", username: "nimal" } });
    const { result } = renderHookWithClient(() => useSession());
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.kind).toBe("web");
    expect(result.current.user).toEqual({ id: "777", username: "nimal" });
    expect(me).toHaveLength(1);
  });

  it("follows the session: a 401 elsewhere signs this hook out", async () => {
    await signInWeb();
    const { result } = renderHookWithClient(() => useSession());
    expect(result.current.status).toBe("authenticated");

    signOut();
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });

  describe("coming back to the app", () => {
    it("on the web, checks that the session is still there", async () => {
      await signInWeb();
      const { result } = renderHookWithClient(() => useSession());
      // signed out elsewhere (another tab, or "log out of all devices")
      const me = backend("GET", "/auth/me", failWith(401, "Unauthorized"));

      setVisibility("hidden");
      expect(me).toHaveLength(0);

      setVisibility("visible");
      await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
      expect(me).toHaveLength(1);
    });

    it("stops checking once the hook is gone", async () => {
      await signInWeb();
      const { unmount } = renderHookWithClient(() => useSession());
      const me = backend("GET", "/auth/me", { user: { telegram_id: "777" } });
      unmount();
      setVisibility("visible");
      expect(me).toHaveLength(0);
    });

    it("in the Mini App, doesn't ask: there is no cookie to check", async () => {
      platform.current = telegramPlatform();
      await signInMiniApp();
      renderHookWithClient(() => useSession());
      const me = backend("GET", "/auth/me", { user: { telegram_id: "777" } });
      setVisibility("visible");
      expect(me).toHaveLength(0);
    });
  });

  describe("logout", () => {
    it("revokes the session, empties the cache and goes to the sign-in page", async () => {
      await signInWeb();
      const logouts = backend("POST", "/auth/logout");
      const { result, queryClient } = renderHookWithClient(() => useSession());
      queryClient.setQueryData(["wallet-summary"], { sats: 5000 });

      await act(() => result.current.logout());

      expect(logouts).toHaveLength(1);
      expect(result.current.status).toBe("unauthenticated");
      // the next account on this device must not see this one's data
      expect(queryClient.getQueryData(["wallet-summary"])).toBeUndefined();
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/");
    });

    it("can log out of all devices", async () => {
      await signInWeb();
      const logouts = backend("POST", "/auth/logout-all");
      const { result } = renderHookWithClient(() => useSession());
      await act(() => result.current.logout(true));
      expect(logouts).toHaveLength(1);
      expect(result.current.status).toBe("unauthenticated");
    });

    it("throws and stays signed in when the backend doesn't confirm", async () => {
      await signInWeb();
      backend("POST", "/auth/logout", failWith(403, "Invalid origin"));
      const { result, queryClient } = renderHookWithClient(() => useSession());
      queryClient.setQueryData(["wallet-summary"], { sats: 5000 });

      await expect(act(() => result.current.logout())).rejects.toThrow("Logout failed (403)");

      expect(result.current.status).toBe("authenticated");
      expect(queryClient.getQueryData(["wallet-summary"])).toEqual({ sats: 5000 });
      expect(router.replace).not.toHaveBeenCalled();
    });
  });
});
