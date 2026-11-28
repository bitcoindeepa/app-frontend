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

/** When to refetch the plan after landing here, until the webhook has landed. */
const PLAN_REFRESH_DELAYS_MS = [5_000, 10_000, 20_000, 30_000];

function PlanPaymentSuccess() {
  const queryClient = useQueryClient();
  useEffect(() => {
    haptic.notify("success");
    void celebrate();
  }, []);

  // A new plan, or a switch that retires the old one: don't show the cached
  // plan. PayHere usually redirects here before its webhook reaches the
  // backend, so one refetch would often cache the old plan as fresh for the
  // default 60 s staleTime. Refetch now and a few times over the next ~30 s.
  useEffect(() => {
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionCurrent });
    refresh();
    const timers = PLAN_REFRESH_DELAYS_MS.map((ms) => setTimeout(refresh, ms));
    return () => timers.forEach(clearTimeout);
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
