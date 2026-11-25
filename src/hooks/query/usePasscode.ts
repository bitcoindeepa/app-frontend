"use client";

import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import fetchy from "@/lib/fetchy";
import { queryKeys } from "@/lib/query-keys";
import { unlockApp, writePasscodeHint } from "@/lib/app-lock";

/** GET /passcode, for this session */
export interface PasscodeStatus {
  enabled: boolean;
  /** This session may move money (always true without a passcode) */
  unlocked: boolean;
  /** Wrong tries left before the next one locks it; null without a passcode */
  attempts_before_lock: number | null;
  /** Every try is refused until then (ISO); null when not locked out */
  locked_until: string | null;
}

/**
 * Error codes from the passcode routes (FetchyError.code):
 * passcode_incorrect (400, data.attempts_before_lock), passcode_locked (429,
 * data.locked_until), passcode_invalid (400), passcode_exists (409),
 * passcode_not_set (404).
 */
export interface PasscodeErrorData {
  code?: string;
  message?: string;
  attempts_before_lock?: number;
  locked_until?: string;
}

export const passcodeStatusOptions = () =>
  queryOptions({
    queryKey: queryKeys.passcode,
    queryFn: () => fetchy.get<PasscodeStatus>("/passcode"),
    // Changes only through the mutations below (or a 403 passcode_required,
    // which invalidates it)
    staleTime: Infinity,
  });

export function usePasscodeStatus() {
  const isAuthed = useSession().status === "authenticated";
  return useQuery({ ...passcodeStatusOptions(), enabled: isAuthed });
}

/** Every passcode mutation answers with the new status */
function usePasscodeMutation<V>(mutationFn: (vars: V) => Promise<PasscodeStatus>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.passcode, status);
      writePasscodeHint(status.enabled);
      if (status.unlocked) unlockApp();
    },
    onError: () => {
      // A wrong try changes attempts_before_lock / locked_until
      void queryClient.invalidateQueries({ queryKey: queryKeys.passcode });
    },
  });
}

export const useSetPasscode = () =>
  usePasscodeMutation((passcode: string) => fetchy.post<PasscodeStatus>("/passcode", { passcode }));

export const useVerifyPasscode = () =>
  usePasscodeMutation((passcode: string) =>
    fetchy.post<PasscodeStatus>("/passcode/verify", { passcode })
  );

export const useChangePasscode = () =>
  usePasscodeMutation((vars: { current: string; passcode: string }) =>
    fetchy.put<PasscodeStatus>("/passcode", vars)
  );

export const useDisablePasscode = () =>
  usePasscodeMutation((passcode: string) =>
    fetchy.post<PasscodeStatus>("/passcode/disable", { passcode })
  );
