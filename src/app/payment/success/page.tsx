"use client";

import { Suspense, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BuyOrderStatus } from "@/components/dashboard/buy/BuyOrderStatus";
import { StatusScreen, SuccessCheck } from "@/components/auth/StatusScreen";
import { buttonVariants } from "@/components/ui/button";
import { celebrate } from "@/lib/celebrate";
import { queryKeys } from "@/lib/query-keys";
import { haptic } from "@/platform";

function PlanPaymentSuccess() {
  const queryClient = useQueryClient();
  useEffect(() => {
    haptic.notify("success");
    void celebrate();
    // A new plan, or a switch that just retired the old one: don't show the
    // cached plan.
    void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionCurrent });
  }, [queryClient]);

  return (
    <StatusScreen
      art={<SuccessCheck />}
      title="Payment successful"
      actions={
        <Link href="/dashboard" className={buttonVariants()}>
          Go to wallet
        </Link>
      }
    >
      Your plan starts as soon as PayHere confirms the payment, usually within a minute. If you
      switched plans, your old plan stops then.
    </StatusScreen>
  );
}

/** One-time buys come back with ?buy_order=<id> (set by the backend). */
function Content() {
  const buyOrder = useSearchParams().get("buy_order");
  return buyOrder ? (
    <BuyOrderStatus orderId={buyOrder} cancelled={false} />
  ) : (
    <PlanPaymentSuccess />
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
