import { describe, expect, it, vi } from "vitest";
import { WebAuthnError } from "@simplewebauthn/browser";
import { FetchyError } from "@/lib/fetchy";
import { PasskeyStepError, deviceName, passkeyCancelled, passkeyErrorMessage } from "@/lib/passkey";

/** What the browser throws when the user closes the passkey prompt */
function notAllowed() {
  const error = new Error("The operation either timed out or was not allowed.");
  error.name = "NotAllowedError";
  return error;
}

const webAuthnError = (code: WebAuthnError["code"], cause: Error = new Error("cause")) =>
  new WebAuthnError({ message: "passkey failed", code, cause });

describe("passkeyCancelled", () => {
  it("is true when the user closed the prompt", () => {
    expect(passkeyCancelled(notAllowed())).toBe(true);
    expect(passkeyCancelled(webAuthnError("ERROR_CEREMONY_ABORTED"))).toBe(true);
    expect(
      passkeyCancelled(webAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", notAllowed()))
    ).toBe(true);
  });

  it("is false for other failures", () => {
    expect(passkeyCancelled(new Error("boom"))).toBe(false);
    expect(passkeyCancelled(webAuthnError("ERROR_INVALID_DOMAIN"))).toBe(false);
    expect(passkeyCancelled(new FetchyError("Nope", 403))).toBe(false);
    expect(passkeyCancelled("cancelled")).toBe(false);
    expect(passkeyCancelled(undefined)).toBe(false);
  });
});

describe("passkeyErrorMessage", () => {
  it("says so when this device already has a passkey", () => {
    expect(passkeyErrorMessage(webAuthnError("ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"))).toBe(
      "This device already has a passkey for Bitcoin Deepa."
    );
  });

  it("asks to try again when the challenge ran out", () => {
    expect(
      passkeyErrorMessage(new FetchyError("Challenge expired", 400, "challenge_expired"))
    ).toBe("That took too long. Try again.");
  });

  it("shows the backend's own message otherwise", () => {
    expect(passkeyErrorMessage(new FetchyError("Passkey not recognised", 403))).toBe(
      "Passkey not recognised"
    );
  });

  it("is gentle when the user closed the prompt", () => {
    expect(passkeyErrorMessage(notAllowed())).toBe("Cancelled. Try again when you're ready.");
  });

  it("has a fallback for anything else", () => {
    expect(passkeyErrorMessage(new Error("boom"))).toBe(
      "Your browser couldn't use a passkey here. Try again."
    );
  });
});

describe("PasskeyStepError", () => {
  it("carries the message to show and whether the user cancelled", () => {
    const cancelled = PasskeyStepError.from(notAllowed());
    expect(cancelled).toBeInstanceOf(PasskeyStepError);
    expect(cancelled.name).toBe("PasskeyStepError");
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.message).toBe("Cancelled. Try again when you're ready.");

    const failed = PasskeyStepError.from(new FetchyError("Passkey not recognised", 403));
    expect(failed.cancelled).toBe(false);
    expect(failed.message).toBe("Passkey not recognised");
  });

  it("returns a PasskeyStepError as it is", () => {
    const original = new PasskeyStepError("Set up a passkey first", true);
    expect(PasskeyStepError.from(original)).toBe(original);
  });
});

describe("deviceName", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15", "iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15", "iPad"],
    ["Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36", "Android phone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Windows PC"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36", "Chromebook"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", "Linux PC"],
    ["SomethingElse/1.0", "Passkey"],
  ])("names %s as %s", (userAgent, expected) => {
    vi.stubGlobal("navigator", { userAgent });
    expect(deviceName()).toBe(expected);
  });
});
