import { describe, expect, it } from "vitest";
import { bankRequiredCopy } from "@/components/dashboard/sell/bank-required";
import type { BankAccount } from "@/hooks/query/useBankAccounts";

const account = (status: BankAccount["status"]): BankAccount => ({
  id: "acc_1",
  bankCode: 7010,
  bankName: "Bank of Ceylon",
  accountNumber: "00123456789",
  accountName: "Nimal Silva",
  status,
  rejectionReason: null,
  createdAt: "2026-11-20T08:00:00Z",
  reviewedAt: null,
});

describe("bankRequiredCopy", () => {
  it("asks for a bank account when there's none", () => {
    expect(bankRequiredCopy(null)).toEqual({
      inReview: false,
      title: "Add a bank account",
      short: "Where your LKR goes. We verify it before the first payout.",
    });
  });

  it("says the account is in review", () => {
    expect(bankRequiredCopy(account("PENDING_REVIEW"))).toEqual({
      inReview: true,
      title: "Bank account in review",
      short: "You can sell once it's verified, usually within a few hours.",
    });
  });

  it("asks for another account after a rejection", () => {
    expect(bankRequiredCopy(account("REJECTED"))).toEqual({
      inReview: false,
      title: "Add a bank account",
      short: "Your last one couldn't be verified. Add another to receive LKR.",
    });
  });
});
