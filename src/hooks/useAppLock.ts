"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/hooks/useSession";
import { usePasscodeStatus } from "@/hooks/query/usePasscode";
import {
  getAppLockSnapshot,
  getServerAppLockSnapshot,
  lockApp,
  readPasscodeHint,
  RELOCK_AFTER_MS,
  subscribeAppLock,
  writePasscodeHint,
} from "@/lib/app-lock";

/**
 * Whether the dashboard is behind the passcode lock screen. Locked when the
 * member has a passcode and either the app locked itself (every launch,
 * after RELOCK_AFTER_MS in the background, or a 403 passcode_required) or
 * the backend says this session hasn't entered it.
 */
export function useAppLock(): boolean {
  const { status } = useSession();
  const { data } = usePasscodeStatus();
  const lockedLocally = useSyncExternalStore(
    subscribeAppLock,
    getAppLockSnapshot,
    getServerAppLockSnapshot
  );
  // Before GET /passcode answers, trust this device's hint so balances don't
  // flash before the lock screen (localStorage; false on the server).
  const hint = useSyncExternalStore(subscribeAppLock, readPasscodeHint, () => false);
  useEffect(() => {
    if (data) writePasscodeHint(data.enabled);
  }, [data]);

  const enabled = data ? data.enabled : hint;

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
