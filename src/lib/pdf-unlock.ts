/**
 * Password-protected PDFs, unlocked on the member's own device. Sri Lankan banks
 * often email statements locked with the holder's NIC or date of birth; the
 * reviewer can't open those, so the member unlocks it here and only the
 * unlocked copy is uploaded. The password never leaves the device.
 *
 * qpdf (compiled to WebAssembly) removes the encryption and keeps the PDF as it
 * was: real text and pages, not a re-rendered picture. It loads only when a PDF
 * is actually locked. Same approach as CeyFi-Web-FE's `lib/pdf-unlock.ts`.
 */

type Qpdf = {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
};
type CreateQpdf = (opts: { locateFile: () => string; noInitialRun?: boolean }) => Promise<Qpdf>;

const WASM_URL = new URL("@neslinesli93/qpdf-wasm/dist/qpdf.wasm", import.meta.url).href;

/**
 * A fresh qpdf for each job: a run leaves state behind in the module, and the
 * wasm comes from the browser's cache after the first load.
 */
async function qpdf() {
  const mod = (await import("@neslinesli93/qpdf-wasm")) as unknown as { default: CreateQpdf };
  // This build ignores print hooks: it binds console.log / console.error once,
  // as the module starts. Hand it collectors for that moment so its output (a
  // locked PDF's "invalid password") goes to `said`, not the console.
  let said: string[] = [];
  const collect = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  const { log, error } = console;
  console.log = console.error = collect;
  let pending: Promise<Qpdf>;
  try {
    pending = mod.default({ locateFile: () => WASM_URL, noInitialRun: true });
  } finally {
    console.log = log;
    console.error = error;
  }
  const q = await pending;

  /**
   * Runs qpdf writing /out.pdf and says whether it did. It may throw rather
   * than return an exit code, so the test is the exit code plus whether the
   * output exists. What it printed tells a wrong password apart.
   */
  const run = (args: string[]) => {
    said = [];
    let code = 2;
    try {
      code = q.callMain(args);
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && typeof e.status === "number") {
        code = e.status;
      }
      said.push(String(e));
    }
    let out: Uint8Array | null = null;
    try {
      out = q.FS.readFile("/out.pdf");
      q.FS.unlink("/out.pdf");
    } catch {}
    // 0 = done, 3 = done with warnings (a slightly malformed file qpdf repaired)
    const ok = (code === 0 || code === 3) && !!out?.length;
    return { out: ok ? out : null, badPassword: said.some((m) => /invalid password/i.test(m)) };
  };
  return { q, run };
}

const hasEncrypt = (bytes: Uint8Array) =>
  new TextDecoder("latin1").decode(bytes).includes("/Encrypt");

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/**
 * True when the PDF needs a password to open. A quick look for an /Encrypt
 * entry first (never compressed, even in an xref stream), so ordinary PDFs never
 * load qpdf. A PDF locked only against editing or printing opens without a
 * password and doesn't count.
 */
export async function pdfNeedsPassword(file: File): Promise<boolean> {
  if (!isPdf(file)) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasEncrypt(bytes)) return false;
  const { q, run } = await qpdf();
  q.FS.writeFile("/in.pdf", bytes);
  // A broken file that won't open at all also lands here; the unlock step's
  // error covers it.
  return !run(["--decrypt", "/in.pdf", "/out.pdf"]).out;
}

export class WrongPdfPassword extends Error {
  constructor() {
    super("That password didn’t open the PDF");
    this.name = "WrongPdfPassword";
  }
}

/**
 * The same PDF with its password and encryption removed, ready to upload.
 * Throws `WrongPdfPassword` on a bad password.
 */
export async function unlockPdf(file: File, password: string): Promise<File> {
  const { q, run } = await qpdf();
  q.FS.writeFile("/in.pdf", new Uint8Array(await file.arrayBuffer()));
  const { out, badPassword } = run([`--password=${password}`, "--decrypt", "/in.pdf", "/out.pdf"]);
  if (!out) {
    if (badPassword) throw new WrongPdfPassword();
    throw new Error("Couldn’t open this PDF. Upload a copy without a password, or a photo of it.");
  }
  // Nothing the reviewer can't open goes up: no encryption may be left at all
  if (hasEncrypt(out)) {
    throw new Error(
      "Couldn’t unlock this PDF. Upload a copy without a password, or a photo of it."
    );
  }
  return new File([out.slice()], file.name, { type: "application/pdf", lastModified: Date.now() });
}
