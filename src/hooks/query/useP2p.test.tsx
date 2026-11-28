// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { Platform } from "@/platform/types";
import type { P2pMe, P2pTransfer } from "@/lib/p2p";
import { telegramPlatform, webPlatform } from "@/test/platform";
import { createTestQueryClient, failure, renderHookWithClient } from "@/test/render";
import { backend, failWith, startBackend } from "@/test/server";
import { signInMiniApp, signInWeb, signOut } from "@/test/session";
import { getSessionSnapshot } from "@/lib/auth";
import { PasskeyStepError } from "@/lib/passkey";
import {
  useP2pMe,
  useP2pSend,
  useP2pTransfer,
  useRecipient,
  type P2pSendInput,
} from "@/hooks/query/useP2p";

const platform = vi.hoisted(() => ({ current: null as unknown as Platform }));
vi.mock("@/platform", () => ({ usePlatform: () => platform.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@simplewebauthn/browser", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

startBackend();

const authenticate = vi.mocked(startAuthentication);

const INPUT: P2pSendInput = {
  to_telegram_id: 4242,
  amount: 5000,
  memo: "lunch",
  idempotency_key: "key-1",
};

const transfer = (over: Partial<P2pTransfer> = {}): P2pTransfer => ({
  id: "tr_1",
  kind: "internal",
  status: "processing",
  amount: 5000,
  created_at: "2026-11-26T04:30:00Z",
  ...over,
});

const PASSKEY = {
  enabled: true,
  unlocked: true,
  available: true,
  lock_on_open: true,
  passkeys: [],
};

/** What a send or a sale's payment refreshes */
const REFRESHED = [["wallet-summary"], ["bot-transactions"], ["p2p", "me"]];

function renderSend() {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHookWithClient(() => useP2pSend(), { queryClient });
  const invalidated = () => invalidate.mock.calls.map(([filter]) => filter?.queryKey);
  return { ...view, invalidated };
}

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ id: "cred-1" } as never);
});

describe("useP2pSend", () => {
  describe("on the web", () => {
    beforeEach(async () => {
      platform.current = webPlatform();
      await signInWeb();
    });

    it("has the member approve the send with a passkey, then sends it with the approval", async () => {
      backend("GET", "/passkey", PASSKEY);
      const approvals = backend("POST", "/passkey/approve/options", { challenge: "abc" });
      const sends = backend("POST", "/p2p/send", transfer());
      const { result, queryClient } = renderSend();

      await act(() => result.current.mutateAsync(INPUT));

      // the approval names this recipient, amount and payment, not the memo
      expect(approvals[0].body).toEqual({
        action: "p2p_send",
        to_telegram_id: 4242,
        amount: 5000,
        idempotency_key: "key-1",
      });
      expect(sends).toHaveLength(1);
      expect(sends[0].body).toEqual(INPUT);
      expect(sends[0].headers.get("X-Passkey-Assertion")).toMatch(/^[A-Za-z0-9_-]+$/);
      // the status screen can show the transfer without another request
      expect(queryClient.getQueryData(["p2p", "transfers", "tr_1"])).toEqual(transfer());
    });

    it("sends nothing when the member closes the passkey prompt", async () => {
      backend("GET", "/passkey", PASSKEY);
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      const sends = backend("POST", "/p2p/send", transfer());
      const cancelled = new Error("Not allowed");
      cancelled.name = "NotAllowedError";
      authenticate.mockRejectedValue(cancelled);
      const { result } = renderSend();

      const error = await failure(() => result.current.mutateAsync(INPUT));

      // a PasskeyStepError tells the screen nothing was sent
      expect(error).toBeInstanceOf(PasskeyStepError);
      expect(error.cancelled).toBe(true);
      expect(sends).toHaveLength(0);
    });

    it("sends nothing when the backend refuses the approval", async () => {
      backend("GET", "/passkey", PASSKEY);
      backend("POST", "/passkey/approve/options", failWith(403, "Daily limit reached"));
      const sends = backend("POST", "/p2p/send", transfer());
      const { result } = renderSend();

      const error = await failure(() => result.current.mutateAsync(INPUT));

      expect(error).toBeInstanceOf(PasskeyStepError);
      expect(error.message).toBe("Daily limit reached");
      expect(sends).toHaveLength(0);
    });

    it("reports a send the backend rejects as the backend's error, not a passkey step", async () => {
      backend("GET", "/passkey", PASSKEY);
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      backend("POST", "/p2p/send", failWith(403, "Log in again", "relogin_required"));
      const { result } = renderSend();

      const error = await failure(() => result.current.mutateAsync(INPUT));

      expect(error).not.toBeInstanceOf(PasskeyStepError);
      expect(error.code).toBe("relogin_required");
      // relogin_required never signs the member out
      expect(getSessionSnapshot().status).toBe("authenticated");
    });

    it("refreshes the balance and history whether the send worked or not", async () => {
      backend("GET", "/passkey", PASSKEY);
      backend("POST", "/passkey/approve/options", { challenge: "abc" });
      backend("POST", "/p2p/send", transfer());
      const ok = renderSend();
      await act(() => ok.result.current.mutateAsync(INPUT));
      expect(ok.invalidated()).toEqual(REFRESHED);

      backend("POST", "/p2p/send", failWith(502, "Bot unreachable"));
      const failed = renderSend();
      await failure(() => failed.result.current.mutateAsync(INPUT));
      expect(failed.invalidated()).toEqual(REFRESHED);
    });
  });

  describe("in the Mini App", () => {
    beforeEach(async () => {
      signOut();
      platform.current = telegramPlatform();
      await signInMiniApp();
    });

    it("sends with the session token and no passkey step", async () => {
      const sends = backend("POST", "/p2p/send", transfer());
      const { result } = renderSend();

      await act(() => result.current.mutateAsync(INPUT));

      expect(sends).toHaveLength(1);
      expect(sends[0].body).toEqual(INPUT);
      expect(sends[0].headers.get("Authorization")).toBe("Bearer session-token");
      expect(sends[0].headers.has("X-Passkey-Assertion")).toBe(false);
      expect(authenticate).not.toHaveBeenCalled();
    });
  });
});

describe("useP2pMe", () => {
  const me: P2pMe = {
    telegram_id: 777,
    balance: 50_000,
    limits: {
      max_amount: 100_000,
      daily_limit: 500_000,
      daily_used: 0,
      daily_remaining: 500_000,
      confirm_threshold: 20_000,
      unconfirmed_remaining: 20_000,
    },
  };

  beforeEach(() => {
    platform.current = webPlatform();
  });

  it("reads the balance and limits for a signed-in member", async () => {
    await signInWeb();
    const requests = backend("GET", "/p2p/me", me);
    const { result } = renderHookWithClient(() => useP2pMe());
    await waitFor(() => expect(result.current.data).toEqual(me));
    expect(requests).toHaveLength(1);
  });

  it("asks nothing while signed out", async () => {
    signOut();
    const requests = backend("GET", "/p2p/me", me);
    renderHookWithClient(() => useP2pMe());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(0);
  });

  it("asks nothing while switched off", async () => {
    await signInWeb();
    const requests = backend("GET", "/p2p/me", me);
    renderHookWithClient(() => useP2pMe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(0);
  });

  it("doesn't retry a relogin_required: asking again can't fix it", async () => {
    await signInWeb();
    const requests = backend("GET", "/p2p/me", failWith(403, "Log in again", "relogin_required"));
    // this query sets its own retry rule, whatever the client's default
    const { result } = renderHookWithClient(() => useP2pMe());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(requests).toHaveLength(1);
  });
});

describe("useP2pTransfer", () => {
  beforeEach(async () => {
    platform.current = webPlatform();
    await signInWeb();
  });

  it("refreshes the balance and history once the transfer is final", async () => {
    backend("GET", "/p2p/transfers/tr_1", transfer({ status: "completed" }));
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithClient(() => useP2pTransfer("tr_1"), { queryClient });

    await waitFor(() => expect(result.current.data?.status).toBe("completed"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual(REFRESHED);
  });

  it("doesn't refresh them while the transfer is still running", async () => {
    backend("GET", "/p2p/transfers/tr_1", transfer({ status: "processing" }));
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithClient(() => useP2pTransfer("tr_1"), { queryClient });

    await waitFor(() => expect(result.current.data?.status).toBe("processing"));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("asks nothing without a transfer id", async () => {
    const requests = backend("GET", "/p2p/transfers/:id", transfer());
    renderHookWithClient(() => useP2pTransfer(""));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(0);
  });
});

describe("useRecipient", () => {
  beforeEach(async () => {
    platform.current = webPlatform();
    await signInWeb();
  });

  it("looks a member up by their @username once typing pauses", async () => {
    const lookups = backend("POST", "/p2p/resolve", { telegram_id: 4242, username: "kasun_77" });
    const { result } = renderHookWithClient(() => useRecipient(" @Kasun_77"));

    await waitFor(() => expect(result.current.data?.telegram_id).toBe(4242));
    expect(lookups).toHaveLength(1);
    expect(lookups[0].body).toEqual({ to: "kasun_77" });
    expect(result.current.valid).toBe(true);
    expect(result.current.settled).toBe(true);
  });

  it.each(["ab", "1kasun", "ka sun", ""])(
    "doesn't look up %j: not a valid username",
    async (typed) => {
      const lookups = backend("POST", "/p2p/resolve", { telegram_id: 4242 });
      const { result } = renderHookWithClient(() => useRecipient(typed));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(result.current.valid).toBe(false);
      expect(lookups).toHaveLength(0);
    }
  );

  it("reports a username no one has, without retrying", async () => {
    const lookups = backend("POST", "/p2p/resolve", failWith(404, "No member with that username"));
    const { result } = renderHookWithClient(() => useRecipient("nobody_here"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(lookups).toHaveLength(1);
  });
});
