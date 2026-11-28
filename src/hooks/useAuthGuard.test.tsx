// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import { pendingPlatform, telegramPlatform, webPlatform } from "@/test/platform";
import { renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { miniAppLogin, signInMiniApp, signInWeb, signOut } from "@/test/session";
import { onUnauthorized } from "@/lib/auth";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useRegisterUser } from "@/hooks/useRegisterUser";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

startBackend();

/** The dashboard layout's guard, next to the launch sign-in that runs app-wide */
const dashboard = () =>
  renderHookWithClient(() => {
    useRegisterUser();
    return useAuthGuard();
  });

beforeEach(() => {
  platform.current = webPlatform();
  router.replace.mockReset();
});

describe("useAuthGuard", () => {
  // First on purpose: the session is only "loading" until it's first resolved in this file
  it("waits while the platform and the session are still unknown", () => {
    platform.current = pendingPlatform();
    const { result } = dashboard();
    expect(result.current).toEqual({ sessionExpired: false, signingIn: false });
    expect(router.replace).not.toHaveBeenCalled();
  });

  describe("on the web", () => {
    it("sends a signed-out visitor to the sign-in page", () => {
      signOut();
      const { result } = dashboard();
      expect(router.replace).toHaveBeenCalledWith("/");
      expect(result.current).toEqual({ sessionExpired: false, signingIn: false });
    });

    it("lets a signed-in member in", async () => {
      await signInWeb();
      const { result } = dashboard();
      expect(router.replace).not.toHaveBeenCalled();
      expect(result.current).toEqual({ sessionExpired: false, signingIn: false });
    });

    it("sends the member to sign in when the session ends later (a 401)", async () => {
      await signInWeb();
      dashboard();
      expect(router.replace).not.toHaveBeenCalled();

      act(() => onUnauthorized(null));
      expect(router.replace).toHaveBeenCalledWith("/");
    });
  });

  describe("in the Mini App", () => {
    beforeEach(() => {
      platform.current = telegramPlatform();
    });

    it("lets a signed-in member in", async () => {
      await signInMiniApp();
      const { result } = dashboard();
      expect(router.replace).not.toHaveBeenCalled();
      expect(result.current).toEqual({ sessionExpired: false, signingIn: false });
    });

    it("keeps the member on the page while it signs in from initData", async () => {
      signOut();
      // never answers during this test
      backend("POST", "/auth/telegram/miniapp", () => new Promise<Response>(() => {}) as never);
      const { result } = dashboard();
      expect(result.current).toEqual({ sessionExpired: false, signingIn: true });
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("keeps their place when the session ends and signs in again", async () => {
      await signInMiniApp();
      const { result } = dashboard();
      backend("POST", "/auth/telegram/miniapp", miniAppLogin({ token: "next-token" }));

      act(() => onUnauthorized("session-token"));
      expect(result.current.signingIn).toBe(true);
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("asks the member to reopen the app when the backend refuses the initData", async () => {
      signOut();
      backend("POST", "/auth/telegram/miniapp", failWith(401, "initData is too old"));
      const { result } = dashboard();
      await waitFor(() =>
        expect(result.current).toEqual({ sessionExpired: true, signingIn: false })
      );
      // no redirect: there is no sign-in page inside Telegram
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("keeps signing in while the backend is only failing, not refusing", async () => {
      signOut();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const logins = backend("POST", "/auth/telegram/miniapp", failWith(503, "Down"));
      const { result } = dashboard();
      await waitFor(() => expect(logins).toHaveLength(1));
      expect(result.current).toEqual({ sessionExpired: false, signingIn: true });
    });

    it("sends a visitor without launch data to the sign-in page", () => {
      signOut();
      platform.current = telegramPlatform({ launch: null });
      dashboard();
      expect(router.replace).toHaveBeenCalledWith("/");
    });
  });
});
