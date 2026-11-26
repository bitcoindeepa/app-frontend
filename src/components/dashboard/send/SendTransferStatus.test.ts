import { describe, expect, it } from "vitest";
import type { P2pTransfer } from "@/lib/p2p";
import { transferRows } from "./SendTransferStatus";

const transfer = (over: Partial<P2pTransfer> = {}): P2pTransfer =>
  ({
    id: "p2p-9473ab12",
    kind: "internal",
    status: "completed",
    amount: 1,
    to: { telegram_id: 1, username: "PiyumS", name: "Piyu S" },
    created_at: "2026-11-26T13:13:00Z",
    ...over,
  }) as P2pTransfer;

const value = (t: P2pTransfer) => transferRows(t).find((r) => r.k === "Value")?.v;

describe("transferRows", () => {
  it("shows the backend's value from when it was sent, with cents", () => {
    expect(value(transfer({ value_lkr: 0.21 }))).toBe("≈ රු. 0.21");
    expect(value(transfer({ amount: 21_000, value_lkr: 5670 }))).toBe("≈ රු. 5,670.00");
  });

  it("hides the row when there's no value, never 0.00", () => {
    expect(value(transfer({ value_lkr: null }))).toBeUndefined();
    expect(value(transfer())).toBeUndefined();
  });

  it('says "1 sat"', () => {
    expect(transferRows(transfer()).find((r) => r.k === "Amount")?.v).toBe("1 sat");
  });
});
