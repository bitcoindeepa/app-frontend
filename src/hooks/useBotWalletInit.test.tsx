// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { Platform } from "@/platform/types";
import { telegramPlatform } from "@/test/platform";
import { createTestQueryClient, renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { miniAppLogin, signOut } from "@/test/session";
import { useBotWalletInit } from "@/hooks/useBotWalletInit";
import { useRegisterUser } from "@/hooks/useRegisterUser";
import { useSession } from "@/hooks/useSession";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

const onCantMessage = vi.fn();

/** The Mini App opens: it signs in, then follows up on what the login said about the bot */
function launch() {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHookWithClient(
    () => {
      useRegisterUser();
      useBotWalletInit(onCantMessage);
      return useSession();
    },
    { queryClient }
  );
  const signedIn = () => waitFor(() => expect(view.result.current.status).toBe("authenticated"));
  return { ...view, invalidate, signedIn };
}

beforeEach(() => {
  signOut();
  platform.current = telegramPlatform();
  onCantMessage.mockReset();
});

describe("useBotWalletInit", () => {
  it("asks to let the bot message a member it can't reach yet", async () => {
    backend("POST", "/auth/telegram/miniapp", miniAppLogin({ canMessage: false }));
    const { signedIn } = launch();
    await signedIn();
    await waitFor(() => expect(platform.current.requestWriteAccess).toHaveBeenCalledTimes(1));
    // fakePlatform allows it inside Telegram
    expect(onCantMessage).not.toHaveBeenCalled();
  });

  it("points the member to the bot when they refuse", async () => {
    platform.current = telegramPlatform({ requestWriteAccess: vi.fn(async () => false) });
    backend("POST", "/auth/telegram/miniapp", miniAppLogin({ canMessage: false }));
    const { signedIn } = launch();
    await signedIn();
    await waitFor(() => expect(onCantMessage).toHaveBeenCalledTimes(1));
  });

  it.each([null, true])("doesn't ask when the login says canMessage: %s", async (canMessage) => {
    backend("POST", "/auth/telegram/miniapp", miniAppLogin({ canMessage }));
    const { signedIn, invalidate } = launch();
    await signedIn();
    // the follow-up has run by the time it refreshes the wallet
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(platform.current.requestWriteAccess).not.toHaveBeenCalled();
    expect(onCantMessage).not.toHaveBeenCalled();
  });

  it("refreshes the wallet once the login has linked it", async () => {
    backend("POST", "/auth/telegram/miniapp", miniAppLogin({ walletLinked: true }));
    const { signedIn, invalidate } = launch();
    await signedIn();
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["wallet-summary"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["p2p", "me"] });
  });

  it("leaves the wallet alone when the bot couldn't be reached", async () => {
    backend(
      "POST",
      "/auth/telegram/miniapp",
      miniAppLogin({ walletLinked: false, canMessage: false })
    );
    const { signedIn, invalidate } = launch();
    await signedIn();
    await waitFor(() => expect(platform.current.requestWriteAccess).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does nothing after a login the backend refused", async () => {
    const logins = backend("POST", "/auth/telegram/miniapp", failWith(401, "initData is too old"));
    const { invalidate } = launch();
    await waitFor(() => expect(logins).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(platform.current.requestWriteAccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(onCantMessage).not.toHaveBeenCalled();
  });
});
