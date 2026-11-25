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
import { unlockApp, writePasskeyHint } from "@/lib/app-lock";
import { deviceName } from "@/lib/passkey";

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

/** Every passkey mutation answers with the new status */
function usePasskeyMutation<V>(mutationFn: (vars: V) => Promise<PasskeyStatus>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.passkey, status);
      writePasskeyHint(status.enabled);
      if (status.unlocked) unlockApp();
    },
  });
}

/** Create a passkey on this device (the browser's prompt) and register it */
export const useAddPasskey = () =>
  usePasskeyMutation(async () => {
    const optionsJSON = await fetchy.post<PublicKeyCredentialCreationOptionsJSON>(
      "/passkey/register/options"
    );
    const response = await startRegistration({ optionsJSON });
    return fetchy.post<PasskeyStatus>("/passkey/register", { response, name: deviceName() });
  });

/** Unlock this session with one of the member's passkeys */
export const useUnlockWithPasskey = () =>
  usePasskeyMutation(async () => {
    const optionsJSON =
      await fetchy.post<PublicKeyCredentialRequestOptionsJSON>("/passkey/unlock/options");
    const response = await startAuthentication({ optionsJSON });
    return fetchy.post<PasskeyStatus>("/passkey/unlock", { response });
  });

export const useRemovePasskey = () =>
  usePasskeyMutation((id: string) => fetchy.delete<PasskeyStatus>(`/passkey/${id}`));
