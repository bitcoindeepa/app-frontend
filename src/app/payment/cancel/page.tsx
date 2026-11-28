"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BuyOrderStatus } from "@/components/dashboard/buy/BuyOrderStatus";
import { BigEmoji, StatusScreen } from "@/components/auth/StatusScreen";
import { buttonVariants } from "@/components/ui/button";
import { stripFrequencySuffix } from "@/components/dashboard/wallet/PlanSummaryCard";
import { useSubscriptionCurrent } from "@/hooks/query/useSubscriptionCurrent";

function PlanPaymentCancelled() {
  // A cancelled switch leaves the old plan running: say so, and go back to it.
  const { data: subscription } = useSubscriptionCurrent();
  const current = subscription?.isActive ? stripFrequencySuffix(subscription.planName) : undefined;
  return (
    <StatusScreen
      art={<BigEmoji src="/emoji/animated/cross-mark.webp" />}
      title="Payment cancelled"
      actions={
        <>
          <Link
            href={current ? "/dashboard/plans" : "/dashboard/plans/choose"}
            className={buttonVariants()}
          >
            Back to plans
          </Link>
          <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>
            Go to wallet
          </Link>
        </>
      }
    >
      {current
        ? `Your payment wasn't completed, so nothing changed: you're still on ${current}.`
        : "Your payment wasn't completed. You can try again anytime from the plans page."}
    </StatusScreen>
  );
}

/** One-time buys come back with ?buy_order=<id> (set by the backend). */
function Content() {
  const buyOrder = useSearchParams().get("buy_order");
  return buyOrder ? <BuyOrderStatus orderId={buyOrder} cancelled /> : <PlanPaymentCancelled />;
}

export default function PaymentCancelPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
