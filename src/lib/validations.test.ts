import { describe, expect, it } from "vitest";
import {
  STATEMENT_MAX_BYTES,
  bankAccountSchema,
  buyAmountSchema,
  createUserSchema,
  normalizeLkPhone,
  sellAmountSchema,
  sendAmountSchema,
  sendMemoSchema,
  sendRecipientSchema,
} from "@/lib/validations";

/** The first error message a schema gives for a value, or null when it passes */
function firstError(schema: { safeParse: (v: unknown) => unknown }, value: unknown) {
  const result = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
  return result.success ? null : (result.error?.issues[0]?.message ?? "");
}

describe("normalizeLkPhone", () => {
  it.each([
    ["0771234567", "+94771234567"],
    ["077 123 4567", "+94771234567"],
    ["077-123-4567", "+94771234567"],
    ["94771234567", "+94771234567"],
    ["+94 77 123 4567", "+94771234567"],
    ["771234567", "+94771234567"],
    ["(077) 123 4567", "+94771234567"],
  ])("turns %s into %s", (typed, expected) => {
    expect(normalizeLkPhone(typed)).toBe(expected);
  });

  it("returns anything else as typed, without spaces", () => {
    expect(normalizeLkPhone("12345")).toBe("12345");
    expect(normalizeLkPhone("+1 415 555 0100")).toBe("+14155550100");
  });
});

describe("createUserSchema", () => {
  const valid = {
    first_name: "Nimal",
    last_name: "Silva",
    email: "nimal@example.com",
    phone: "077 123 4567",
    address: "12 Galle Road",
    city: "Colombo",
    country: "Sri Lanka",
  };

  it("accepts a filled-in form and sends the phone as +94", () => {
    const result = createUserSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+94771234567");
  });

  it("refuses a number that isn't Sri Lankan", () => {
    expect(firstError(createUserSchema, { ...valid, phone: "+1 415 555 0100" })).toBe(
      "Enter a Sri Lankan number, e.g. 0771234567"
    );
  });

  it("asks for a phone number when it's empty", () => {
    expect(firstError(createUserSchema, { ...valid, phone: "" })).toBe("Phone number is required");
  });

  it("refuses a bad email", () => {
    expect(firstError(createUserSchema, { ...valid, email: "nimal@" })).toBe(
      "Please provide a valid email address"
    );
  });

  it("refuses a short address", () => {
    expect(firstError(createUserSchema, { ...valid, address: "12" })).toBe(
      "Address must be at least 5 characters"
    );
  });
});

describe("bankAccountSchema", () => {
  const statement = (type = "application/pdf", size = 1024) =>
    new File([new Uint8Array(size)], "statement", { type });
  const valid = () => ({
    bankCode: 7010,
    accountNumber: "0012 3456-789",
    accountName: "  Nimal Silva ",
    statement: statement(),
  });

  it("accepts an account and cleans the number and name", () => {
    const result = bankAccountSchema.safeParse(valid());
    expect(result.success).toBe(true);
    expect(result.data?.accountNumber).toBe("00123456789");
    expect(result.data?.accountName).toBe("Nimal Silva");
  });

  it("needs a bank", () => {
    expect(firstError(bankAccountSchema, { ...valid(), bankCode: undefined })).toBe(
      "Choose your bank"
    );
    expect(firstError(bankAccountSchema, { ...valid(), bankCode: 0 })).toBe("Choose your bank");
  });

  it.each(["12345", "123456789012345678901", "12AB5678"])(
    "refuses the account number %s",
    (accountNumber) => {
      expect(firstError(bankAccountSchema, { ...valid(), accountNumber })).toBe(
        "Account number must be 6–20 digits"
      );
    }
  );

  it("needs an account holder name", () => {
    expect(firstError(bankAccountSchema, { ...valid(), accountName: "   " })).toBe(
      "Account holder name is required"
    );
  });

  it("needs a statement", () => {
    expect(firstError(bankAccountSchema, { ...valid(), statement: undefined })).toBe(
      "Upload a bank statement"
    );
  });

  it("takes PDF, JPEG and PNG statements only", () => {
    for (const type of ["application/pdf", "image/jpeg", "image/png"]) {
      expect(firstError(bankAccountSchema, { ...valid(), statement: statement(type) })).toBeNull();
    }
    expect(firstError(bankAccountSchema, { ...valid(), statement: statement("image/gif") })).toBe(
      "Statement must be a PDF, JPEG or PNG"
    );
  });

  it("refuses an empty statement or one over 8 MB", () => {
    const tooBig = statement("application/pdf", STATEMENT_MAX_BYTES + 1);
    const atLimit = statement("application/pdf", STATEMENT_MAX_BYTES);
    const empty = statement("application/pdf", 0);
    expect(firstError(bankAccountSchema, { ...valid(), statement: atLimit })).toBeNull();
    for (const file of [tooBig, empty]) {
      expect(firstError(bankAccountSchema, { ...valid(), statement: file })).toBe(
        "Statement must be 8 MB or smaller"
      );
    }
  });
});

describe("sellAmountSchema", () => {
  it("accepts an amount between the minimum and the balance", () => {
    const schema = sellAmountSchema(50_000);
    expect(firstError(schema, 1000)).toBeNull();
    expect(firstError(schema, 50_000)).toBeNull();
  });

  it("refuses less than the minimum", () => {
    expect(firstError(sellAmountSchema(50_000), 999)).toBe("Minimum is 1,000 sats");
    expect(firstError(sellAmountSchema(50_000, 2500), 2499)).toBe("Minimum is 2,500 sats");
  });

  it("refuses more than the balance", () => {
    expect(firstError(sellAmountSchema(50_000), 50_001)).toBe("That's more than your balance");
  });

  it("points at the savings pots when they're why", () => {
    expect(firstError(sellAmountSchema(50_000, 1000, 1_000_000, 20_000), 60_000)).toBe(
      "You can use 50,000 sats. 20,000 are in savings pots"
    );
  });

  it("refuses more than the limit per sale", () => {
    expect(firstError(sellAmountSchema(5_000_000, 1000, 1_000_000), 1_000_001)).toBe(
      "Maximum per sale is 1,000,000 sats"
    );
  });

  it("takes whole sats only", () => {
    expect(firstError(sellAmountSchema(50_000), 1500.5)).toBe("Use whole sats");
    expect(firstError(sellAmountSchema(50_000), Number.NaN)).toBe("Enter an amount in sats");
    expect(firstError(sellAmountSchema(50_000), undefined)).toBe("Enter an amount in sats");
  });
});

describe("buyAmountSchema", () => {
  it("accepts whole rupees within the limits", () => {
    const schema = buyAmountSchema(500, 100_000);
    expect(firstError(schema, 500)).toBeNull();
    expect(firstError(schema, 100_000)).toBeNull();
  });

  it("names the limit it refuses with", () => {
    const schema = buyAmountSchema(500, 100_000);
    expect(firstError(schema, 499)).toBe("Minimum is රු. 500.00");
    expect(firstError(schema, 100_001)).toBe("Maximum per buy is රු. 100,000.00");
  });

  it("takes whole rupees only", () => {
    expect(firstError(buyAmountSchema(), 250.5)).toBe("Use whole rupees");
    expect(firstError(buyAmountSchema(), undefined)).toBe("Enter an amount in LKR");
  });

  it("has a minimum of 100 until the price loads", () => {
    expect(firstError(buyAmountSchema(), 99)).toBe("Minimum is රු. 100.00");
    expect(firstError(buyAmountSchema(), 100)).toBeNull();
  });
});

describe("sendAmountSchema", () => {
  // balance, max per send, left today
  const schema = sendAmountSchema(50_000, 100_000, 30_000);

  it("accepts an amount within every limit", () => {
    expect(firstError(schema, 1)).toBeNull();
    expect(firstError(schema, 30_000)).toBeNull();
  });

  it("refuses zero and negative amounts", () => {
    expect(firstError(schema, 0)).toBe("Enter an amount in sats");
    expect(firstError(schema, -5)).toBe("Enter an amount in sats");
  });

  it("takes whole sats only", () => {
    expect(firstError(schema, 10.5)).toBe("Use whole sats");
  });

  it("refuses more than is left today", () => {
    expect(firstError(schema, 30_001)).toBe("You can send 30,000 more sats today");
  });

  it("refuses more than the limit per send", () => {
    expect(firstError(sendAmountSchema(500_000, 100_000, 400_000), 100_001)).toBe(
      "Maximum per send is 100,000 sats"
    );
  });

  it("refuses more than the balance", () => {
    expect(firstError(sendAmountSchema(5_000, 100_000, 30_000), 5_001)).toBe(
      "That's more than your balance"
    );
    expect(firstError(sendAmountSchema(5_000, 100_000, 30_000, 2_000), 6_000)).toBe(
      "You can use 5,000 sats. 2,000 are in savings pots"
    );
  });
});

describe("send recipient and memo", () => {
  it("trims the recipient", () => {
    expect(sendRecipientSchema.parse("  @kasun ")).toBe("@kasun");
  });

  it("needs a recipient", () => {
    expect(firstError(sendRecipientSchema, "   ")).toBe("Enter a @username or Telegram ID");
  });

  it("refuses a recipient over 64 characters", () => {
    expect(firstError(sendRecipientSchema, "a".repeat(65))).toBe(
      "That's too long for a username or ID"
    );
  });

  it("keeps the memo to 280 characters", () => {
    expect(firstError(sendMemoSchema, "a".repeat(280))).toBeNull();
    expect(firstError(sendMemoSchema, "a".repeat(281))).toBe("Keep the note under 280 characters");
  });
});
