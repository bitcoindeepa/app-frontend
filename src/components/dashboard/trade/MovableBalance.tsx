"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useWalletSummary } from "@/hooks/query/useWalletSummary";
import { TELEGRAM_BOT_URL } from "@/lib/constants";
import { fmtSatsUnit, fmtSats } from "@/lib/formatters";
import { usePlatform } from "@/platform";

/**
 * "You have 6,443,655 sats movable ⓘ" under a sell/send amount. The ⓘ opens
 * a breakdown of the wallet: what can move, what sits in savings pots (each
 * pot) and what's still being sent.
 */
export function MovableHint({ movableSats }: { movableSats: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      You have <span className="num">{fmtSats(movableSats)}</span> sats movable
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="What's movable"
        className="press text-ink3 ml-1 inline-flex size-[18px] translate-y-[3px] items-center justify-center rounded-full border-0 bg-transparent p-0"
      >
        <InfoIcon />
      </button>
      <BalanceBreakdownSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function BalanceBreakdownSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const platform = usePlatform();
  const summary = useWalletSummary();
  const { refetch } = summary;

  // Every number here comes from one summary response, so they add up. Fetch
  // it again on open: it may be a few seconds old.
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const data = summary.data?.balance_available === false ? undefined : summary.data;
  const total = data?.total_balance ?? 0;
  const pots = data?.pots ?? [];
  const potSats = data?.pot_balance ?? 0;
  const movable = data?.spendable_balance ?? total;
  // spendable_balance is documented as total minus pots, so this is normally
  // 0 and the row stays hidden. It only shows when the bot also holds back
  // sats it is sending (it doesn't say so in a field of its own), so the three
  // rows always add up to the total
  const sending = Math.max(total - movable - potSats, 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Your balance">
      <div className="flex flex-col gap-5 px-4 pb-6">
        {!data ? (
          <p className="text-ink2 text-center text-[15px] leading-[22px]">
            {summary.isFetching
              ? "Loading your balance…"
              : "Your balance couldn't be loaded right now."}
          </p>
        ) : (
          <>
            <div className="text-center">
              <p className="text-ink2 text-[13px] leading-[18px] font-semibold">In your wallet</p>
              <p className="num text-[28px] leading-9 font-bold">{fmtSatsUnit(total)}</p>
            </div>

            <BalanceBar
              total={total}
              parts={[
                { sats: movable, className: "bg-primary" },
                { sats: potSats, className: "bg-ink3" },
                { sats: sending, className: "bg-ink3/40" },
              ]}
            />

            <ul className="flex flex-col gap-3">
              <Row
                dot="bg-primary"
                label="Movable"
                note="You can sell or send these now"
                sats={movable}
              />
              <Row
                dot="bg-ink3"
                label="In savings pots"
                note={
                  potSats > 0
                    ? "Locked until you withdraw them in the bot"
                    : "You have no sats in savings pots"
                }
                sats={potSats}
              >
                {pots.length > 0 && (
                  <ul className="border-line mt-2 flex flex-col gap-1.5 border-l-2 pl-3">
                    {pots.map((pot, i) => (
                      <li
                        key={`${pot.name}-${i}`}
                        className="flex items-center justify-between gap-3 text-[13px] leading-[18px]"
                      >
                        <span className="text-ink2 flex min-w-0 items-center gap-1.5">
                          <LockIcon />
                          <span className="truncate">{pot.name}</span>
                        </span>
                        <span className="num text-ink2 shrink-0">{fmtSatsUnit(pot.balance)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
              {sending > 0 && (
                <Row
                  dot="bg-ink3/40"
                  label="Being sent"
                  note="Held by a payment that hasn't finished yet"
                  sats={sending}
                />
              )}
            </ul>

            <p className="text-ink2 text-[13px] leading-[18px]">
              Sats in savings pots stay in your wallet and count in your total, but they can&apos;t
              be sold or sent. Withdraw them from the pot in the Bitcoin Deepa bot to move them.
            </p>
          </>
        )}
        <Button variant="secondary" onClick={() => platform.openTelegramLink(TELEGRAM_BOT_URL)}>
          Manage pots in the bot
        </Button>
      </div>
    </Sheet>
  );
}

/** One horizontal bar split by sats; a non-empty part is never thinner than a sliver. */
function BalanceBar({
  total,
  parts,
}: {
  total: number;
  parts: { sats: number; className: string }[];
}) {
  const shown = parts.filter((p) => p.sats > 0);
  return (
    <div
      className="bg-line flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
      role="img"
      aria-label="Your wallet split into movable sats and sats in savings pots"
    >
      {total > 0 &&
        shown.map((p, i) => (
          <div
            key={i}
            className={cn("h-full min-w-1.5", p.className)}
            style={{ flexGrow: p.sats, flexBasis: 0 }}
          />
        ))}
    </div>
  );
}

function Row({
  dot,
  label,
  note,
  sats,
  children,
}: {
  dot: string;
  label: string;
  note: string;
  sats: number;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className={cn("mt-[5px] size-2.5 shrink-0 rounded-full", dot)} />
          <div className="min-w-0">
            <p className="text-[15px] leading-5 font-semibold">{label}</p>
            <p className="text-ink2 text-[13px] leading-[18px]">{note}</p>
          </div>
        </div>
        <p className="num shrink-0 text-[15px] leading-5 font-semibold">{fmtSatsUnit(sats)}</p>
      </div>
      {children}
    </li>
  );
}

function InfoIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.1" strokeWidth="2.8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      className="size-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
