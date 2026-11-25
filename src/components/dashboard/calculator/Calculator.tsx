"use client";

import { useId, useState } from "react";
import { cn } from "cn";
import { BtcCoin } from "@/components/ui/btc-coin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Presets } from "@/components/dashboard/trade/DualAmount";
import { fmtLkrPreset, LKR_SYMBOL } from "@/lib/formatters";
import {
  cleanAmount,
  convert,
  fmtCalc,
  groupTyped,
  type CalcRates,
  type CalcUnit,
} from "@/lib/calculator";
import { useCalculatorRates } from "./useCalculatorRates";

const LKR_PRESETS = [1_000, 5_000, 10_000, 25_000];

/** LKR, USD, BTC and sats boxes: type in any one and the others follow the app's price. */
export function Calculator() {
  const id = useId();
  const { rates, usdLkr, updatedAt, isLoading, isError, isFetching, refetch } =
    useCalculatorRates();
  const [input, setInput] = useState<{ unit: CalcUnit; raw: string }>({
    unit: "lkr",
    raw: "10000",
  });

  const amount = input.raw === "" ? null : Number(input.raw);
  const values = rates && amount !== null ? convert(amount, input.unit, rates) : null;

  const text = (unit: CalcUnit) => {
    if (unit === input.unit) return groupTyped(input.raw);
    const v = values?.[unit];
    return v === null || v === undefined ? "" : fmtCalc(v, unit);
  };

  if (isLoading) return <CalculatorSkeleton />;

  if (isError || !rates) {
    return (
      <Card className="flex flex-col items-center gap-3 px-5 py-6 text-center">
        <p className="text-[16px] font-bold">Prices are unavailable</p>
        <p className="text-ink2 text-[14px] leading-5">
          We couldn&apos;t get the Bitcoin price right now. Try again in a moment.
        </p>
        <Button size="default" variant="secondary" loading={isFetching} onClick={() => refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* A card under the boxes, as in the Buy sheet, so they stand out in dark mode too */}
      <Card className="p-2.5 pb-3">
        <div className="flex flex-col gap-2.5">
          <AmountBox
            id={`${id}-lkr`}
            label="Sri Lankan rupees"
            unit="lkr"
            active={input.unit === "lkr"}
            value={text("lkr")}
            onChange={(raw) => setInput({ unit: "lkr", raw: cleanAmount(raw, "lkr") })}
            pill={<UnitPill icon={<FiatCoin>රු</FiatCoin>} code="LKR" />}
          />
          <AmountBox
            id={`${id}-usd`}
            label="US dollars"
            unit="usd"
            active={input.unit === "usd"}
            value={text("usd")}
            disabled={!rates.btcUsd}
            placeholder={rates.btcUsd ? "0" : "Unavailable"}
            onChange={(raw) => setInput({ unit: "usd", raw: cleanAmount(raw, "usd") })}
            pill={
              <UnitPill
                icon={<FiatCoin className="bg-gain-fill text-white">$</FiatCoin>}
                code="USD"
              />
            }
          />
          <AmountBox
            id={`${id}-btc`}
            label="Bitcoin"
            unit="btc"
            active={input.unit === "btc"}
            value={text("btc")}
            onChange={(raw) => setInput({ unit: "btc", raw: cleanAmount(raw, "btc") })}
            pill={<UnitPill icon={<BtcCoin className="size-7" />} code="BTC" />}
          />
          <AmountBox
            id={`${id}-sats`}
            label="Satoshis"
            unit="sats"
            active={input.unit === "sats"}
            value={text("sats")}
            onChange={(raw) => setInput({ unit: "sats", raw: cleanAmount(raw, "sats") })}
            pill={<UnitPill icon={<BtcCoin className="size-7" />} code="sats" />}
          />
        </div>
        <Presets
          items={LKR_PRESETS.map((lkr) => ({
            label: fmtLkrPreset(lkr),
            on: input.unit === "lkr" && Number(input.raw) === lkr,
            pick: () => setInput({ unit: "lkr", raw: String(lkr) }),
          }))}
        />
      </Card>

      <RatesCard rates={rates} usdLkr={usdLkr} updatedAt={updatedAt} />
    </div>
  );
}

function AmountBox({
  id,
  label,
  unit,
  active,
  value,
  onChange,
  pill,
  disabled,
  placeholder = "0",
}: {
  id: string;
  label: string;
  unit: CalcUnit;
  /** The box being typed in */
  active: boolean;
  value: string;
  onChange: (raw: string) => void;
  pill: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] px-4 pt-3 pb-3.5 transition-[background-color,box-shadow] duration-200",
        active
          ? "bg-card shadow-[0_0_0_2px_var(--primary)]"
          : "bg-chip focus-within:bg-card focus-within:shadow-[0_0_0_2px_var(--primary)]"
      )}
    >
      <label htmlFor={id} className="text-ink2 block text-[12px] font-semibold">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2.5">
        <input
          id={id}
          inputMode={unit === "sats" ? "numeric" : "decimal"}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "num placeholder:text-ink3 min-w-0 flex-1 border-0 bg-transparent p-0 text-[28px] leading-[1.2] font-bold tracking-[-0.02em] outline-none disabled:opacity-60",
            active ? "text-foreground" : "text-ink2"
          )}
        />
        {pill}
      </div>
    </div>
  );
}

function FiatCoin({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-inv text-on-inv flex size-7 items-center justify-center rounded-full text-[11px] font-bold",
        className
      )}
    >
      {children}
    </span>
  );
}

function UnitPill({ icon, code }: { icon: React.ReactNode; code: string }) {
  return (
    <span className="bg-card inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1 text-[14px] font-bold">
      {icon}
      {code}
    </span>
  );
}

const cents = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function RatesCard({
  rates,
  usdLkr,
  updatedAt,
}: {
  rates: CalcRates;
  usdLkr?: number;
  updatedAt?: number;
}) {
  const rows = [
    { label: "1 BTC", value: `${LKR_SYMBOL} ${cents(rates.btcLkr)}` },
    rates.btcUsd !== undefined && { label: "1 BTC", value: `$${cents(rates.btcUsd)}` },
    usdLkr !== undefined && { label: "1 USD", value: `${LKR_SYMBOL} ${cents(usdLkr)}` },
  ].filter((r) => r !== false);

  return (
    <Card className="px-4 py-3.5">
      <p className="text-ink2 text-[12px] font-semibold">Rates</p>
      <dl className="mt-1 flex flex-col">
        {rows.map((r) => (
          <div
            key={r.value}
            className="border-line flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
          >
            <dt className="text-ink2 text-[14px] font-semibold">{r.label}</dt>
            <dd className="num text-[15px] font-bold">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink3 mt-1 text-[12px] leading-4 font-semibold">
        Our buy price, before fees
        {updatedAt
          ? ` · updated ${new Date(updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
        . Updates automatically.
      </p>
    </Card>
  );
}

function CalculatorSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy aria-label="Loading prices">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-chip h-[86px] rounded-[20px] px-4 pt-3">
          <span className="skeleton block h-3 w-24 rounded" />
          <span className="skeleton mt-3 block h-7 w-36 rounded" />
        </div>
      ))}
    </div>
  );
}
