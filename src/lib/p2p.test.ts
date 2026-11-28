import { describe, expect, it } from "vitest";
import {
  isReloginError,
  normalizeRecipient,
  p2pPollInterval,
  recipientLabel,
  type P2pTransferStatus,
} from "@/lib/p2p";

describe("p2pPollInterval", () => {
  it("doesn't poll before the transfer has loaded", () => {
    expect(p2pPollInterval(undefined)).toBe(false);
  });

  it.each<P2pTransferStatus>(["completed", "failed", "cancelled", "expired"])(
    "stops once the transfer is %s",
    (status) => {
      expect(p2pPollInterval(status)).toBe(false);
    }
  );

  it("polls every 2.5s while it runs or waits for Confirm", () => {
    expect(p2pPollInterval("processing")).toBe(2_500);
    expect(p2pPollInterval("awaiting_confirmation")).toBe(2_500);
  });

  it("polls every 20s while a payment is in flight", () => {
    expect(p2pPollInterval("in_flight")).toBe(20_000);
  });
});

describe("recipientLabel", () => {
  it("shows the name and the @username", () => {
    expect(recipientLabel({ telegram_id: 1, name: "Bob Silva", username: "bob" })).toBe(
      "Bob Silva (@bob)"
    );
  });

  it("doesn't repeat a name that is the @username", () => {
    expect(recipientLabel({ telegram_id: 1, name: "@bob", username: "bob" })).toBe("@bob");
  });

  it("falls back to the name, the @username, then the id", () => {
    expect(recipientLabel({ telegram_id: 1, name: "Bob Silva" })).toBe("Bob Silva");
    expect(recipientLabel({ telegram_id: 1, username: "bob", name: null })).toBe("@bob");
    expect(recipientLabel({ telegram_id: 12345 })).toBe("12345");
    expect(recipientLabel(undefined)).toBe("");
  });
});

describe("helpers", () => {
  it("recognises the relogin error", () => {
    expect(isReloginError("relogin_required")).toBe(true);
    expect(isReloginError("passkey_required")).toBe(false);
    expect(isReloginError(undefined)).toBe(false);
  });

  it("trims the recipient as typed", () => {
    expect(normalizeRecipient("  @Bob ")).toBe("@Bob");
  });
});
