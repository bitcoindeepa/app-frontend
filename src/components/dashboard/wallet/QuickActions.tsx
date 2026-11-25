"use client";

import { useRouter } from "next/navigation";
import { haptic } from "@/platform";
import { useSheets } from "@/components/dashboard/sheets";

const ICONS = {
  buy: <path d="M12 5v14M19 12l-7 7-7-7" />,
  sell: <path d="M12 19V5M5 12l7-7 7 7" />,
  send: (
    <>
      <path d="M20.5 4.5L4 11l4.6 1.7 1.4 5.3 2.6-3 4.3 3.1z" />
      <path d="M8.6 12.7l7.9-5.2" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8.5 7.5h7M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01M9 18h.01M12 18h.01M15 18h.01" />
    </>
  ),
};

/** Buy / Sell / Send / Calculator tiles under the Total value card. */
export function QuickActions() {
  const { openTrade, openSend } = useSheets();
  const router = useRouter();

  return (
    <div role="group" aria-label="Quick actions" className="-mt-2 grid grid-cols-4 gap-2">
      <Action
        icon={ICONS.buy}
        label="Buy"
        onClick={() => {
          haptic.impact("light");
          openTrade("buy");
        }}
      />
      <Action
        icon={ICONS.sell}
        label="Sell"
        onClick={() => {
          haptic.impact("light");
          openTrade("sell");
        }}
      />
      <Action
        icon={ICONS.send}
        label="Send"
        onClick={() => {
          haptic.impact("light");
          openSend();
        }}
      />
      <Action
        icon={ICONS.calculator}
        label="Calculator"
        onClick={() => {
          haptic.impact("light");
          router.push("/dashboard/calculator");
        }}
      />
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press bg-tile text-on-tile relative flex h-[55px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border-0 px-1 py-1.5 text-[11px] leading-[13px] font-medium"
    >
      <svg
        className="size-7"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {icon}
      </svg>
      <span className="block w-full text-center">{label}</span>
    </button>
  );
}
