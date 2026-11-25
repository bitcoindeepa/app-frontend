"use client";

import { useAppLock } from "@/hooks/useAppLock";
import { PasskeyLock } from "@/components/passkey/PasskeyLock";

/**
 * The passkey lock for the whole app (mounted once in the root providers),
 * so every signed-in route is behind it: the dashboard, but also
 * /verification (KYC details), /plans and /payment. PasskeyLock covers the
 * screen and makes everything else in <body> inert while it's up.
 */
export function AppLockGate() {
  const locked = useAppLock();
  return locked ? <PasskeyLock /> : null;
}
