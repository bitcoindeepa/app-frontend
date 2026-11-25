"use client";

import { useRouter } from "next/navigation";
import { PushHeader } from "@/components/ui/back-button";
import { Calculator } from "@/components/dashboard/calculator/Calculator";

/** /dashboard/calculator: convert between LKR, USD and BTC at the app's price. */
export default function CalculatorPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-5">
      <PushHeader title="Calculator" onBack={() => router.push("/dashboard")} />
      <Calculator />
    </div>
  );
}
