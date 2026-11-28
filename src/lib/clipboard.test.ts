// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/clipboard";

const writeText = vi.fn(async () => {});
const execCommand = vi.fn(() => true);

/** What the hidden field held when the old copy command ran */
let copied: string | undefined;

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  copied = undefined;
  execCommand.mockReset().mockImplementation(() => {
    copied = document.querySelector("textarea")?.value;
    return true;
  });
  // jsdom has neither
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  vi.stubGlobal("isSecureContext", true);
});

afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard;
  delete (document as { execCommand?: unknown }).execCommand;
});

describe("copyText", () => {
  it("uses the Clipboard API", async () => {
    await copyText("@nimal");
    expect(writeText).toHaveBeenCalledExactlyOnceWith("@nimal");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to the old copy command where the Clipboard API is denied", async () => {
    writeText.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    await copyText("@nimal");
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    expect(copied).toBe("@nimal");
  });

  it.each([
    ["on a page that isn't secure (a LAN address)", () => vi.stubGlobal("isSecureContext", false)],
    [
      "in a webview without the Clipboard API",
      () => delete (navigator as { clipboard?: unknown }).clipboard,
    ],
  ])("falls back %s", async (_where, arrange) => {
    arrange();
    await copyText("tr_12345678");
    expect(writeText).not.toHaveBeenCalled();
    expect(copied).toBe("tr_12345678");
  });

  it("leaves nothing behind on the page, and gives the focus back", async () => {
    delete (navigator as { clipboard?: unknown }).clipboard;
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    await copyText("@nimal");

    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it.each([
    ["refuses", () => false],
    [
      "throws",
      () => {
        throw new Error("Not supported");
      },
    ],
  ])("fails, so the caller can say so, when the old command %s too", async (_how, command) => {
    delete (navigator as { clipboard?: unknown }).clipboard;
    execCommand.mockImplementation(command);
    await expect(copyText("@nimal")).rejects.toThrow("Copy failed");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
