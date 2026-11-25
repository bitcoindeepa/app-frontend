// BTC / LKR / USD conversions for the calculator sheet.

export type CalcUnit = "lkr" | "usd" | "btc" | "sats";

export interface CalcRates {
  /** LKR per BTC (the app's buy price) */
  btcLkr: number;
  /** USD per BTC; undefined while the dollar rate is unknown */
  btcUsd?: number;
}

const SATS_PER_BTC = 100_000_000;

/** Round away float noise (0.1 + 0.2) before flooring or showing a value */
const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Whole sats, rounded down like a buy */
const floorSats = (btc: number) => Math.floor(round(btc * SATS_PER_BTC, 6));

function toBtc(amount: number, unit: CalcUnit, rates: CalcRates): number | null {
  switch (unit) {
    case "btc":
      return amount;
    case "sats":
      return amount / SATS_PER_BTC;
    case "lkr":
      return amount / rates.btcLkr;
    case "usd":
      return rates.btcUsd ? amount / rates.btcUsd : null;
  }
}

/**
 * `amount` of `from` in every unit. The typed unit keeps its exact value; BTC
 * and sats round down to whole sats (so they always agree), LKR and USD to
 * cents. USD is null while the dollar rate is unknown.
 */
export function convert(
  amount: number,
  from: CalcUnit,
  rates: CalcRates
): Record<CalcUnit, number | null> | null {
  const btc = toBtc(amount, from, rates);
  if (btc === null) return null;
  const sats = floorSats(btc);
  return {
    btc: from === "btc" ? amount : sats / SATS_PER_BTC,
    sats: from === "sats" ? amount : sats,
    lkr: from === "lkr" ? amount : round(btc * rates.btcLkr, 2),
    usd: from === "usd" ? amount : rates.btcUsd ? round(btc * rates.btcUsd, 2) : null,
  };
}

/** Decimal places each unit can be typed with */
export const CALC_DECIMALS: Record<CalcUnit, number> = { lkr: 2, usd: 2, btc: 8, sats: 0 };

/**
 * Most whole-number digits each unit takes: 16 for sats (all 21M BTC is
 * 2,100,000,000,000,000), 15 otherwise (the most a JS number holds exactly).
 */
const MAX_DIGITS: Record<CalcUnit, number> = { lkr: 15, usd: 15, btc: 15, sats: 16 };

/** Keeps digits and one dot (up to the unit's decimals); drops grouping commas and leading zeros. */
export function cleanAmount(raw: string, unit: CalcUnit): string {
  const decimals = CALC_DECIMALS[unit];
  const [whole = "", ...rest] = raw.replace(/[^\d.]/g, "").split(".");
  const int = whole.replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS[unit]);
  if (decimals === 0 || rest.length === 0) return int;
  return `${int || "0"}.${rest.join("").slice(0, decimals)}`;
}

const formatters: Record<CalcUnit, Intl.NumberFormat> = {
  lkr: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
  usd: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
  btc: new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }),
  sats: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
};

/** A value as a box shows it, grouped ("12,345.5") */
export const fmtCalc = (value: number, unit: CalcUnit) => formatters[unit].format(value);

/** What the user typed, grouped but otherwise as typed ("12345." -> "12,345.") */
export function groupTyped(raw: string): string {
  if (raw === "") return "";
  const [int, frac] = raw.split(".");
  const grouped = Number(int || "0").toLocaleString("en-US");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}
