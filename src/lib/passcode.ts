/**
 * App passcode rules, mirroring the backend (src/modules/passcode/passcode.ts)
 * so the sheet can say what's wrong before sending. The backend decides.
 */
export const PASSCODE_LENGTH = 6;

/** Why a new passcode can't be used, or null */
export function passcodeProblem(code: string): string | null {
  if (!/^\d{6}$/.test(code)) return `Use exactly ${PASSCODE_LENGTH} digits.`;
  if (/^(\d)\1+$/.test(code)) return "Too easy to guess: avoid repeating one digit.";
  const digits = [...code].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return "Too easy to guess: avoid a straight run like 123456.";
  }
  return null;
}
