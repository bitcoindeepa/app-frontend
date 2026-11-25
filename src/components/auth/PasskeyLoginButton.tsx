"use client";

import { useState } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import fetchy from "@/lib/fetchy";
import { refreshWebSession } from "@/lib/auth";
import { unlockApp, writePasskeyHint } from "@/lib/app-lock";
import { passkeyCancelled, passkeyErrorMessage } from "@/lib/passkey";
import { haptic } from "@/platform";

/**
 * "Sign in with passkey" on the web login screen, for members who added a
 * passkey in settings. The browser lists the passkeys it has for this site;
 * the backend checks the chosen one and sets the session cookie, already
 * unlocked (so the lock doesn't ask again). useSession then moves on to the
 * dashboard. Hidden where the browser can't do passkeys.
 */
export function PasskeyLoginButton({ onError }: { onError: (message: string | null) => void }) {
  // Only rendered on the client (the login screen waits for the platform)
  const [supported] = useState(() => typeof window !== "undefined" && browserSupportsWebAuthn());
  const [busy, setBusy] = useState(false);
  if (!supported) return null;

  const signIn = async () => {
    haptic.impact("light");
    setBusy(true);
    onError(null);
    try {
      const { attempt_id, options } = await fetchy.post<{
        attempt_id: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>("/auth/passkey/options");
      const response = await startAuthentication({ optionsJSON: options });
      await fetchy.post("/auth/passkey/login", { attempt_id, response });
      haptic.notify("success");
      writePasskeyHint(true);
      unlockApp();
      await refreshWebSession();
    } catch (error) {
      // Closing the browser's prompt isn't an error worth a red line
      if (!passkeyCancelled(error)) {
        haptic.notify("error");
        onError(passkeyErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="secondary" loading={busy} onClick={() => void signIn()}>
      <svg
        className="size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="8" cy="15" r="4" />
        <path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" />
      </svg>
      Sign in with passkey
    </Button>
  );
}
