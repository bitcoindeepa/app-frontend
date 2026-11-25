"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/hooks/useSession";
import { usePasskeyStatus } from "@/hooks/query/usePasskey";
import { usePlatform } from "@/platform";
import {
  getAppLockSnapshot,
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
