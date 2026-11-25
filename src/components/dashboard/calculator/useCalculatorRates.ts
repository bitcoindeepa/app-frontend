"use client";

import { useBuyPrice } from "@/hooks/query/useBuy";
import { useWalletSummary } from "@/hooks/query/useWalletSummary";
import type { CalcRates } from "@/lib/calculator";

/**
 * The app's own prices: BTC/LKR is the live buy price (/buy/price, refreshed
 * every 30s). The wallet summary's BTC price in USD and LKR gives the dollar
 * rate (CeyPay's USDT/LKR, which moves slowly). If the buy price is down, the
 * summary's BTC/LKR stands in.
 */
export function useCalculatorRates() {
  const buy = useBuyPrice();
  const summary = useWalletSummary();
  const priced = summary.data?.current_btc_price;

  const btcLkr = buy.data?.btcLkrPrice ?? priced?.lkr;
  const usdPerLkr = priced?.usd && priced.lkr ? priced.usd / priced.lkr : undefined;
  const rates: CalcRates | null = btcLkr
    ? { btcLkr, btcUsd: usdPerLkr ? btcLkr * usdPerLkr : undefined }
    : null;

  return {
    rates,
    /** LKR per USD, for the rate line */
    usdLkr: usdPerLkr ? 1 / usdPerLkr : undefined,
    /** When the BTC/LKR price was fetched */
    updatedAt: buy.data ? buy.dataUpdatedAt : priced ? summary.dataUpdatedAt : undefined,
    isLoading: !rates && (buy.isPending || summary.isPending),
    isError: !rates && buy.isError && (summary.isError || !priced),
    isFetching: buy.isFetching || summary.isFetching,
    refetch: () => Promise.all([buy.refetch(), summary.refetch()]),
  };
}
