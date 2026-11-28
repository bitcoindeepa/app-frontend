"use client";

import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useSession } from "@/hooks/useSession";
import fetchy from "@/lib/fetchy";
import { queryKeys } from "@/lib/query-keys";
import { locksOnOpen, unlockApp, writePasskeyHint } from "@/lib/app-lock";
import { deviceName, PasskeyStepError } from "@/lib/passkey";
import { usePlatform } from "@/platform";
import { useCallback } from "react";

export interface PasskeyView {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** GET /passkey, for this session */
export interface PasskeyStatus {
  /** The member has at least one passkey (the web app locks) */
  enabled: boolean;
  /** This session may move money (always true without one, and in the Mini App) */
  unlocked: boolean;
  /** Passkeys work here: a web session (never inside Telegram) */
  available: boolean;
  /**
   * Ask for the passkey when the app opens (the member's setting, on by
   * default; false without a passkey). Sends and sale payments ask either way.
   */
  lock_on_open: boolean;
  passkeys: PasskeyView[];
}

export const passkeyStatusOptions = () =>
  queryOptions({
    queryKey: queryKeys.passkey,
    queryFn: () => fetchy.get<PasskeyStatus>("/passkey"),
    // Changes only through the mutations below
    staleTime: Infinity,
  });

export function usePasskeyStatus() {
  const isAuthed = useSession().status === "authenticated";
  return useQuery({ ...passkeyStatusOptions(), enabled: isAuthed });
}

/**
 * Every passkey mutation answers with the new status. They share one scope,
 * so TanStack runs them one after another (an add and a remove tapped
 * together are queued, not refused): each answer is then newer than the one
 * before, and an older status never overwrites a newer list.
 */
function usePasskeyMutation<V>(mutationFn: (vars: V) => Promise<PasskeyStatus>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    scope: { id: "passkey" },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.passkey, status);
      writePasskeyHint(locksOnOpen(status));
      if (status.unlocked) unlockApp();
    },
  });
}

/** Create a passkey on this device (the browser's prompt) and register it */
async function registerPasskey(): Promise<PasskeyStatus> {
  const optionsJSON = await fetchy.post<PublicKeyCredentialCreationOptionsJSON>(
    "/passkey/register/options"
  );
  const response = await startRegistration({ optionsJSON });
  return fetchy.post<PasskeyStatus>("/passkey/register", { response, name: deviceName() });
}

export const useAddPasskey = () => usePasskeyMutation(registerPasskey);

/** The browser's passkey prompt, then POST /passkey/unlock */
async function unlockSession(): Promise<PasskeyStatus> {
  const optionsJSON =
    await fetchy.post<PublicKeyCredentialRequestOptionsJSON>("/passkey/unlock/options");
  const response = await startAuthentication({ optionsJSON });
  return fetchy.post<PasskeyStatus>("/passkey/unlock", { response });
}

/** Unlock this session with one of the member's passkeys */
export const useUnlockWithPasskey = () => usePasskeyMutation(unlockSession);

/**
 * Ask (or not) for the passkey when the app opens. Turning it off always asks
 * for the passkey first, even when this session is still unlocked (that lasts
 * 12 h): switching off a lock needs the member, not just their open browser.
 */
export function useSetLockOnOpen() {
  return usePasskeyMutation(async (lockOnOpen: boolean) => {
    if (!lockOnOpen) await unlockSession();
    return fetchy.patch<PasskeyStatus>("/passkey/settings", { lock_on_open: lockOnOpen });
  });
}

export const useRemovePasskey = () =>
  usePasskeyMutation((id: string) => fetchy.delete<PasskeyStatus>(`/passkey/${id}`));

/** What a passkey approval is for (the backend binds it to exactly this) */
export type ApprovalAction =
  | { action: "p2p_send"; to_telegram_id: number; amount: number; idempotency_key: string }
  | { action: "sell_pay"; order_id: string };

/**
 * Approve one send or sale payment with a passkey (web/PWA; mandatory
 * there). Resolves to the headers to send with that request; inside
 * Telegram (no passkeys) to none. A member without a passkey is asked to
 * set one up first. Throws PasskeyStepError if a step doesn't complete.
 */
export function usePasskeyApproval() {
  const { kind, confirm } = usePlatform();
  const queryClient = useQueryClient();

  return useCallback(
    async (action: ApprovalAction): Promise<Record<string, string>> => {
      if (kind !== "web") return {};
      try {
        let status = await queryClient.fetchQuery(passkeyStatusOptions());
        if (!status.available) return {};
        if (!status.enabled) {
          const ok = await confirm({
            title: "Set up a passkey",
            message:
              "To keep your sats safe, sending and selling in the browser need a passkey: Face ID, fingerprint or your device PIN. It takes a few seconds.",
            confirmText: "Set up passkey",
            cancelText: "Not now",
          });
          if (!ok) throw new PasskeyStepError("You need a passkey to continue.", true);
          status = await registerPasskey();
          queryClient.setQueryData(queryKeys.passkey, status);
          writePasskeyHint(locksOnOpen(status));
          unlockApp();
        }
        const optionsJSON = await fetchy.post<PublicKeyCredentialRequestOptionsJSON>(
          "/passkey/approve/options",
          action
        );
        const response = await startAuthentication({ optionsJSON });
        return { "X-Passkey-Assertion": toBase64Url(JSON.stringify(response)) };
      } catch (error) {
        throw PasskeyStepError.from(error);
      }
    },
    [kind, confirm, queryClient]
  );
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
