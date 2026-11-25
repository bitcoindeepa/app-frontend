"use client";

import { useAppLock } from "@/hooks/useAppLock";
import { PasskeyLock } from "@/components/passkey/PasskeyLock";

/**
 * The passkey lock for the whole app (mounted once in the root providers),
 * so every signed-in route is behind it: the dashboard, but also
 * /verification (KYC details), /plans and /payment.
 *
 * Routed content lives inside one persistent wrapper whose `inert` and
 * `aria-hidden` follow the lock, so a page mounted while locked (Back/Forward
 * to another route) is unusable from its first render. The lock itself
 * portals into <body>, outside the wrapper, and also makes inert anything
 * else that appears in <body> while it's up (sheets, dialogs).
 */
export function AppLockBoundary({ children }: { children: React.ReactNode }) {
  const locked = useAppLock();
  return (
    <>
      <div inert={locked} aria-hidden={locked || undefined}>
        {children}
      </div>
      {locked && <PasskeyLock />}
    </>
  );
}
