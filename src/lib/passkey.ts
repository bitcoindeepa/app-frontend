import { WebAuthnError } from "@simplewebauthn/browser";
import { FetchyError } from "@/lib/fetchy";

/** A name for a new passkey from the device, e.g. "iPhone" (shown in settings) */
export function deviceName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux PC";
  return "Passkey";
}

/** The user closed the browser's passkey prompt (not worth an error toast) */
export function passkeyCancelled(error: unknown): boolean {
  return (
    (error instanceof WebAuthnError && error.code === "ERROR_CEREMONY_ABORTED") ||
    (error instanceof Error && error.name === "NotAllowedError") ||
    (error instanceof WebAuthnError &&
      error.cause instanceof Error &&
      error.cause.name === "NotAllowedError")
  );
}

/** What to tell the user when a passkey step fails */
export function passkeyErrorMessage(error: unknown): string {
  if (
    error instanceof WebAuthnError &&
    error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
  ) {
    return "This device already has a passkey for Bitcoin Deepa.";
  }
  if (error instanceof FetchyError) {
    if (error.code === "challenge_expired") return "That took too long. Try again.";
    return error.message;
  }
  if (passkeyCancelled(error)) return "Cancelled. Try again when you're ready.";
  return "Your browser couldn't use a passkey here. Try again.";
}
