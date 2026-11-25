"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSession } from "@/hooks/useSession";
import { usePasskeyStatus } from "@/hooks/query/usePasskey";
import { usePlatform } from "@/platform";
import {
  getAppLockSnapshot,
  getPasskeyRequiredSnapshot,
  getServerAppLockSnapshot,
  lockApp,
  readPasskeyHint,
  RELOCK_AFTER_MS,
  subscribeAppLock,
  writePasskeyHint,
} from "@/lib/app-lock";

/**
 * Whether the dashboard is behind the passkey lock screen. Web/PWA only
 * (the Mini App can't use passkeys). Locked when the member has a passkey
 * and either the app locked itself (every launch, after RELOCK_AFTER_MS in
 * the background, or a 403 passkey_required) or the backend says this
 * session hasn't unlocked.
 */
export function useAppLock(): boolean {
  const { status } = useSession();
  const { kind } = usePlatform();
  const { data } = usePasskeyStatus();
  const lockedLocally = useSyncExternalStore(
    subscribeAppLock,
    getAppLockSnapshot,
    getServerAppLockSnapshot
  );
  // Before GET /passkey answers, trust this device's hint so balances don't
  // flash before the lock screen (localStorage; false on the server).
  const hint = useSyncExternalStore(subscribeAppLock, readPasskeyHint, () => false);
  useEffect(() => {
    if (data) writePasskeyHint(data.enabled);
  }, [data]);

  const enabled = kind === "web" && (data ? data.enabled && data.available : hint);

  // Ask the backend again when it says this session must unlock (a 403
  // passkey_required) or the app relocks after the background: the cached
  // status may be stale, e.g. a passkey added from another session while
  // this tab still thinks there's none, and then the lock would never show.
  const queryClient = useQueryClient();
  const required = useSyncExternalStore(subscribeAppLock, getPasskeyRequiredSnapshot, () => 0);
  const wasLocked = useRef(lockedLocally);
  const seenRequired = useRef(required);
  useEffect(() => {
    const relocked = lockedLocally && !wasLocked.current;
    if (relocked || required !== seenRequired.current) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.passkey });
    }
    wasLocked.current = lockedLocally;
    seenRequired.current = required;
  }, [lockedLocally, required, queryClient]);

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt >= RELOCK_AFTER_MS) {
        lockApp();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled]);

  if (status !== "authenticated" || !enabled) return false;
  return lockedLocally || !data || !data.unlocked;
}
