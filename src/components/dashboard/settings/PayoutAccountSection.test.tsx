// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { stubLocation } from "@/test/dom";
import { setPlatform, webPlatform } from "@/test/platform";
import { renderScreen } from "@/test/render";
import { answer, backend, failWith, startBackend } from "@/test/server";
import { signInWeb, signOut } from "@/test/session";
import { getAppLockSnapshot, unlockApp } from "@/lib/app-lock";
import type { BankAccount } from "@/hooks/query/useBankAccounts";
import { PayoutAccountSection } from "@/components/dashboard/settings/PayoutAccountSection";

vi.mock("@/platform", async () => (await import("@/test/platform")).platformModule());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

startBackend();

const account = (over: Partial<BankAccount> = {}): BankAccount => ({
  id: "acc_1",
  bankCode: 7010,
  bankName: "Bank of Ceylon",
  accountNumber: "•••• 6789",
  accountName: "Nimal Silva",
  status: "VERIFIED",
  rejectionReason: null,
  createdAt: "2026-11-01T04:00:00Z",
  reviewedAt: "2026-11-01T08:00:00Z",
  ...over,
});

const BANKS = [
  { code: 7010, name: "Bank of Ceylon" },
  { code: 7056, name: "Commercial Bank" },
  { code: 7278, name: "Sampath Bank" },
];

const UPLOAD_URL = "https://storage.test/statements/key-1";

/** Renders the section for a member with these accounts and this KYC status */
async function open(accounts: BankAccount[] = [], kyc = "APPROVED") {
  backend("GET", "/user/kyc/status", { status: kyc });
  const list = backend("GET", "/bank-accounts", () => accounts);
  backend("GET", "/bank-accounts/banks", BANKS);
  const view = renderScreen(<PayoutAccountSection />);
  await waitFor(() => expect(list.length).toBeGreaterThan(0));
  // past the loading placeholder
  await screen.findByText(/Verify your identity first|Get LKR when you sell sats|· Nimal Silva/);
  return { ...view, list };
}

const statement = (type = "application/pdf", size = 2048, name = "statement.pdf") =>
  new File([new Uint8Array(size)], name, { type });

type User = Awaited<ReturnType<typeof open>>["user"];

/** Opens the add form and fills it in. Leaves out whatever is passed as null. */
async function fillIn(
  user: User,
  {
    bankName = "Commercial Bank" as string | null,
    number = "0012 3456-7890" as string | null,
    name = "Nimal Silva" as string | null,
    file = statement() as File | null,
  } = {}
) {
  await user.click(screen.getByRole("button", { name: /Add (bank|another) account/ }));
  const form = await screen.findByRole("dialog", { name: "Add bank account" });
  if (bankName) {
    await user.click(within(form).getByRole("button", { name: "Choose your bank" }));
    await user.click(await screen.findByRole("button", { name: bankName }));
    await screen.findByRole("dialog", { name: "Add bank account" });
  }
  if (number) await user.type(screen.getByRole("textbox", { name: "Account number" }), number);
  if (name) await user.type(screen.getByRole("textbox", { name: "Account holder name" }), name);
  if (file) {
    // set directly: the picker's file-type filter is a hint, and a member can get past it
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  }
}

const submit = (user: User) =>
  user.click(screen.getByRole("button", { name: "Submit for review" }));

/** The three requests adding an account makes */
function uploadWorks() {
  const reserved = backend("POST", "/bank-accounts/statement-upload", {
    key: "statements/key-1",
    uploadUrl: UPLOAD_URL,
    method: "PUT",
    headers: { "Content-Type": "application/pdf", "x-amz-meta-user": "777" },
    maxBytes: 8 * 1024 * 1024,
  });
  const uploaded = answer("PUT", UPLOAD_URL, () => new Response(null, { status: 200 }));
  const created = backend("POST", "/bank-accounts", account({ status: "PENDING_REVIEW" }));
  return { reserved, uploaded, created };
}

beforeEach(async () => {
  signOut();
  setPlatform(webPlatform());
  stubLocation("/dashboard");
  unlockApp();
  await signInWeb();
});

describe("PayoutAccountSection", () => {
  describe("what it shows", () => {
    it("asks an unverified member to verify their identity first", async () => {
      await open([], "NOT_STARTED");
      expect(screen.getByText("Verify your identity first")).toBeTruthy();
      expect(
        screen.getByText("Once you're verified, add the bank account you want to get paid to.")
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Add bank account/ })).toBeNull();
    });

    it("offers a verified member without an account to add one", async () => {
      await open();
      expect(screen.getByRole("button", { name: /Add bank account/ })).toBeTruthy();
    });

    it("shows a verified account, masked, and where the rupees go", async () => {
      await open([account()]);
      expect(screen.getByText("Bank of Ceylon")).toBeTruthy();
      expect(screen.getByText("Verified")).toBeTruthy();
      expect(screen.getByText("•••• 6789 · Nimal Silva")).toBeTruthy();
      expect(screen.getByText("Rupees from selling sats are sent to this account.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
    });

    it("says an account in review is being checked", async () => {
      await open([account({ status: "PENDING_REVIEW" })]);
      expect(screen.getByText("In review")).toBeTruthy();
      expect(screen.getByText(/We check your statement against your ID/)).toBeTruthy();
    });

    it("shows why an account was rejected, and offers another, but not removing it", async () => {
      await open([
        account({ status: "REJECTED", rejectionReason: "The name doesn't match your ID." }),
      ]);
      expect(screen.getByText("Rejected")).toBeTruthy();
      expect(screen.getByText("The name doesn't match your ID.")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Add another account/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    });

    it("has a reason of its own when the backend gives none", async () => {
      await open([account({ status: "REJECTED" })]);
      expect(
        screen.getByText("This account couldn't be verified against your identity.")
      ).toBeTruthy();
    });

    it("shows the account in review over an older rejected one", async () => {
      await open([
        account({ id: "old", status: "REJECTED", bankName: "Sampath Bank" }),
        account({ id: "new", status: "PENDING_REVIEW", bankName: "Commercial Bank" }),
      ]);
      expect(screen.getByText("Commercial Bank")).toBeTruthy();
      expect(screen.queryByText("Sampath Bank")).toBeNull();
    });
  });

  describe("removing", () => {
    it("removes the account after the member confirms, saying what that means", async () => {
      const platform = setPlatform(webPlatform());
      const removed = backend(
        "DELETE",
        "/bank-accounts/acc_1",
        () => new Response(null, { status: 204 })
      );
      const { user } = await open([account()]);

      await user.click(screen.getByRole("button", { name: "Remove Bank of Ceylon •••• 6789" }));

      expect(await screen.findByText("Bank account removed")).toBeTruthy();
      expect(platform.confirm).toHaveBeenCalledExactlyOnceWith({
        title: "Remove bank account?",
        message:
          "Bank of Ceylon •••• 6789 won't get payouts any more. To sell again, you'll add an account and wait for it to be verified.",
        confirmText: "Remove",
        cancelText: "Keep it",
        destructive: true,
      });
      expect(removed).toHaveLength(1);
    });

    it("removes nothing when the member keeps it", async () => {
      setPlatform(webPlatform({ confirm: vi.fn(async () => false) }));
      const removed = backend("DELETE", "/bank-accounts/acc_1");
      const { user } = await open([account()]);

      await user.click(screen.getByRole("button", { name: "Remove Bank of Ceylon •••• 6789" }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(removed).toHaveLength(0);
    });

    it("explains that a sale is still in progress when the backend says 409", async () => {
      backend("DELETE", "/bank-accounts/acc_1", failWith(409, "Conflict"));
      const { user } = await open([account()]);

      await user.click(screen.getByRole("button", { name: "Remove Bank of Ceylon •••• 6789" }));

      expect(await screen.findByText("Couldn't remove the account")).toBeTruthy();
      expect(screen.getByText("A sale to this account is still in progress.")).toBeTruthy();
    });

    it("locks the app when the backend wants the passkey first", async () => {
      backend(
        "DELETE",
        "/bank-accounts/acc_1",
        failWith(403, "Unlock with your passkey", "passkey_required")
      );
      const { user } = await open([account()]);

      await user.click(screen.getByRole("button", { name: "Remove Bank of Ceylon •••• 6789" }));

      expect(await screen.findByText("Couldn't remove the account")).toBeTruthy();
      expect(getAppLockSnapshot()).toBe(true);
    });
  });

  describe("adding", () => {
    it("uploads the statement to storage, then submits the account for review", async () => {
      const { reserved, uploaded, created } = uploadWorks();
      const { user, list } = await open();
      const before = list.length;
      const file = statement();
      await fillIn(user, { file });

      await submit(user);

      expect(await screen.findByText("Bank account submitted")).toBeTruthy();
      // 1. a place to upload to, sized and typed for this file
      expect(reserved[0].body).toEqual({ contentType: "application/pdf", size: 2048 });
      // 2. the file itself, straight to storage: no session cookie or token goes with it
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0].bytes).toBe(2048);
      expect(uploaded[0].headers.get("x-amz-meta-user")).toBe("777");
      expect(uploaded[0].headers.has("Authorization")).toBe(false);
      // 3. the account, with the number cleaned up and the upload's key
      expect(created[0].body).toEqual({
        bankCode: 7056,
        accountNumber: "001234567890",
        accountName: "Nimal Silva",
        statementKey: "statements/key-1",
      });
      // the list is read again, and the form is gone
      await waitFor(() => expect(list.length).toBeGreaterThan(before));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Add bank account" })).toBeNull()
      );
    });

    it("finds a bank by searching", async () => {
      const { user } = await open();
      await user.click(screen.getByRole("button", { name: /Add bank account/ }));
      await user.click(await screen.findByRole("button", { name: "Choose your bank" }));
      await screen.findByRole("dialog", { name: "Choose your bank" });

      await user.type(screen.getByPlaceholderText("Search banks"), "samp");
      expect(screen.getByRole("button", { name: "Sampath Bank" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Commercial Bank" })).toBeNull();

      await user.clear(screen.getByPlaceholderText("Search banks"));
      await user.type(screen.getByPlaceholderText("Search banks"), "zzz");
      expect(screen.getByText("No banks match “zzz”")).toBeTruthy();
    });

    it("says so when the banks can't be loaded", async () => {
      const { user } = await open();
      backend("GET", "/bank-accounts/banks", failWith(500, "Something went wrong"));
      await user.click(screen.getByRole("button", { name: /Add bank account/ }));
      await user.click(await screen.findByRole("button", { name: "Choose your bank" }));
      expect(await screen.findByText("Couldn't load banks. Try again shortly.")).toBeTruthy();
    });

    it("names everything that is missing, and sends nothing", async () => {
      const { reserved } = uploadWorks();
      const { user } = await open();
      await fillIn(user, { bankName: null, number: null, name: null, file: null });

      await submit(user);

      expect(await screen.findByText("Account number must be 6–20 digits")).toBeTruthy();
      // the bank button's own text, and the error under it
      expect(screen.getAllByText("Choose your bank")).toHaveLength(2);
      expect(screen.getByText("Account holder name is required")).toBeTruthy();
      expect(screen.getByText("Upload a bank statement")).toBeTruthy();
      expect(reserved).toHaveLength(0);
    });

    it("clears a field's error once it is corrected", async () => {
      const { user } = await open();
      await fillIn(user, { number: "12" });
      await submit(user);
      expect(await screen.findByText("Account number must be 6–20 digits")).toBeTruthy();

      await user.type(screen.getByRole("textbox", { name: "Account number" }), "3456");
      await waitFor(() =>
        expect(screen.queryByText("Account number must be 6–20 digits")).toBeNull()
      );
    });

    it.each([
      [
        "a file that isn't a PDF, JPEG or PNG",
        statement("image/gif", 2048, "statement.gif"),
        "Statement must be a PDF, JPEG or PNG",
      ],
      [
        "a file over 8 MB",
        statement("application/pdf", 8 * 1024 * 1024 + 1),
        "Statement must be 8 MB or smaller",
      ],
    ])("refuses %s as soon as it is picked", async (_what, file, message) => {
      const { reserved } = uploadWorks();
      const { user } = await open();
      await fillIn(user, { file });

      expect(await screen.findByText(message)).toBeTruthy();
      await submit(user);
      expect(reserved).toHaveLength(0);
    });

    it("shows the picked statement's name and size, and lets it be changed", async () => {
      const { user } = await open();
      await fillIn(user, { file: statement("image/png", 3 * 1024 * 1024, "passbook.png") });
      expect(screen.getByText("passbook.png")).toBeTruthy();
      expect(screen.getByText("3.0 MB")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
    });

    it("says the upload failed, and creates no account, when storage refuses the file", async () => {
      const { created } = uploadWorks();
      answer("PUT", UPLOAD_URL, () => new Response("<Error/>", { status: 403 }));
      const { user } = await open();
      await fillIn(user);

      await submit(user);

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Couldn't upload the statement, please try again"
      );
      expect(created).toHaveLength(0);
      // still there to try again, with what was typed
      expect(
        (screen.getByRole("textbox", { name: "Account number" }) as HTMLInputElement).value
      ).toBe("0012 3456-7890");
    });

    it("shows the backend's reason when it refuses the account", async () => {
      uploadWorks();
      backend("POST", "/bank-accounts", failWith(400, "You already have an account in review"));
      const { user } = await open();
      await fillIn(user);

      await submit(user);

      expect((await screen.findByRole("alert")).textContent).toBe(
        "You already have an account in review"
      );
    });

    it("locks the app when the backend wants the passkey first", async () => {
      backend(
        "POST",
        "/bank-accounts/statement-upload",
        failWith(403, "Unlock with your passkey", "passkey_required")
      );
      const { user } = await open();
      await fillIn(user);

      await submit(user);

      expect((await screen.findByRole("alert")).textContent).toBe("Unlock with your passkey");
      expect(getAppLockSnapshot()).toBe(true);
    });

    it("starts empty again after being closed", async () => {
      const { user } = await open();
      await fillIn(user);
      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Add bank account" })).toBeNull()
      );

      await user.click(screen.getByRole("button", { name: /Add bank account/ }));
      await screen.findByRole("dialog", { name: "Add bank account" });
      expect(
        (screen.getByRole("textbox", { name: "Account number" }) as HTMLInputElement).value
      ).toBe("");
      expect(screen.getByRole("button", { name: "Choose your bank" })).toBeTruthy();
    });
  });
});
